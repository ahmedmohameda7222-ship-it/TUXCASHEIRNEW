import { DatabaseSync } from 'node:sqlite';
import type { WhatsAppInboxSnapshot } from '@tux/application';
import { instant } from '@tux/domain';
import type {
  ShopId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';
import type {
  CachedWhatsAppInboxSnapshot,
  WhatsAppDraft,
  WhatsAppStore,
} from '../whatsappStore';
import { applySqliteMigrations } from './migrations';

interface PayloadRow {
  readonly payload_json: string;
}

interface DraftRow {
  readonly shop_id: string;
  readonly conversation_id: string;
  readonly text: string;
  readonly updated_at: string;
}

export class SqliteWhatsAppStore implements WhatsAppStore {
  #database: DatabaseSync | null = null;

  constructor(private readonly databasePath: string) {}

  async initialize(): Promise<void> {
    if (this.#database !== null) return;

    const database = new DatabaseSync(this.databasePath);
    try {
      database.exec('PRAGMA foreign_keys = ON;');
      database.exec('PRAGMA synchronous = FULL;');
      database.exec('PRAGMA busy_timeout = 5000;');
      applySqliteMigrations(database);
      this.#database = database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async upsertRemoteSnapshot(snapshot: WhatsAppInboxSnapshot): Promise<void> {
    const database = this.#requireDatabase();
    const conversationShops = new Map(
      snapshot.conversations.map((conversation) => [conversation.id, conversation.shopId] as const),
    );

    database.exec('BEGIN IMMEDIATE');
    try {
      const upsertConversation = database.prepare(`
INSERT INTO whatsapp_cache_conversations(id, shop_id, last_message_at, payload_json)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  shop_id = excluded.shop_id,
  last_message_at = excluded.last_message_at,
  payload_json = excluded.payload_json
`);
      for (const conversation of snapshot.conversations) {
        upsertConversation.run(
          conversation.id,
          conversation.shopId,
          conversation.lastMessageAt,
          JSON.stringify(conversation),
        );
      }

      const upsertMessage = database.prepare(`
INSERT INTO whatsapp_cache_messages(id, shop_id, conversation_id, created_at, payload_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  shop_id = excluded.shop_id,
  conversation_id = excluded.conversation_id,
  created_at = excluded.created_at,
  payload_json = excluded.payload_json
`);
      for (const message of snapshot.messages) {
        upsertMessage.run(
          message.id,
          message.shopId,
          message.conversationId,
          message.createdAt,
          JSON.stringify(message),
        );
      }

      const upsertQuickReply = database.prepare(`
INSERT INTO whatsapp_cache_quick_replies(id, shop_id, payload_json)
VALUES (?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  shop_id = excluded.shop_id,
  payload_json = excluded.payload_json
`);
      for (const quickReply of snapshot.quickReplies) {
        upsertQuickReply.run(quickReply.id, quickReply.shopId, JSON.stringify(quickReply));
      }

      const findConversationShop = database.prepare(
        'SELECT shop_id FROM whatsapp_cache_conversations WHERE id = ?',
      );
      const upsertOrderLink = database.prepare(`
INSERT INTO whatsapp_cache_order_links(shop_id, conversation_id, order_id, linked_at, payload_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(shop_id, conversation_id, order_id) DO UPDATE SET
  linked_at = excluded.linked_at,
  payload_json = excluded.payload_json
`);
      for (const orderLink of snapshot.orderLinks) {
        const cachedShop = conversationShops.get(orderLink.conversationId);
        const row = cachedShop
          ? null
          : (findConversationShop.get(orderLink.conversationId) as { shop_id?: unknown } | undefined);
        const shopId = cachedShop ?? (typeof row?.shop_id === 'string' ? row.shop_id : null);
        if (shopId === null) {
          throw new Error(
            `Cannot cache WhatsApp order link without a tenant-fenced conversation: ${orderLink.conversationId}`,
          );
        }
        upsertOrderLink.run(
          shopId,
          orderLink.conversationId,
          orderLink.orderId,
          orderLink.linkedAt,
          JSON.stringify(orderLink),
        );
      }

      database.exec('COMMIT');
    } catch (error) {
      if (database.isTransaction) database.exec('ROLLBACK');
      throw error;
    }
  }

  async upsertMessage(message: WhatsAppMessage): Promise<void> {
    const database = this.#requireDatabase();
    database
      .prepare(`
INSERT INTO whatsapp_cache_messages(id, shop_id, conversation_id, created_at, payload_json)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  shop_id = excluded.shop_id,
  conversation_id = excluded.conversation_id,
  created_at = excluded.created_at,
  payload_json = excluded.payload_json
`)
      .run(
        message.id,
        message.shopId,
        message.conversationId,
        message.createdAt,
        JSON.stringify(message),
      );
  }

  async loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot> {
    const database = this.#requireDatabase();
    const conversations = database
      .prepare(`
SELECT payload_json
FROM whatsapp_cache_conversations
WHERE shop_id = ?
ORDER BY last_message_at DESC, id ASC
`)
      .all(shopId) as unknown as PayloadRow[];
    const messages = database
      .prepare(`
SELECT payload_json
FROM whatsapp_cache_messages
WHERE shop_id = ?
ORDER BY created_at ASC, id ASC
`)
      .all(shopId) as unknown as PayloadRow[];
    const quickReplies = database
      .prepare(`
SELECT payload_json
FROM whatsapp_cache_quick_replies
WHERE shop_id = ?
ORDER BY id ASC
`)
      .all(shopId) as unknown as PayloadRow[];
    const orderLinks = database
      .prepare(`
SELECT payload_json
FROM whatsapp_cache_order_links
WHERE shop_id = ?
ORDER BY conversation_id ASC, order_id ASC
`)
      .all(shopId) as unknown as PayloadRow[];

    return {
      conversations: conversations.map((row) => JSON.parse(row.payload_json) as WhatsAppConversation),
      messages: messages.map((row) => JSON.parse(row.payload_json) as WhatsAppMessage),
      quickReplies: quickReplies.map((row) => JSON.parse(row.payload_json) as WhatsAppQuickReply),
      orderLinks: orderLinks.map(
        (row) => JSON.parse(row.payload_json) as CachedWhatsAppInboxSnapshot['orderLinks'][number],
      ),
    };
  }

  async listMessages(
    shopId: ShopId,
    conversationId: string,
  ): Promise<readonly WhatsAppMessage[]> {
    const database = this.#requireDatabase();
    const rows = database
      .prepare(`
SELECT payload_json
FROM whatsapp_cache_messages
WHERE shop_id = ? AND conversation_id = ?
ORDER BY created_at ASC, id ASC
`)
      .all(shopId, conversationId) as unknown as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload_json) as WhatsAppMessage);
  }

  async saveDraft(draft: WhatsAppDraft): Promise<void> {
    const database = this.#requireDatabase();
    database
      .prepare(`
INSERT INTO whatsapp_drafts(shop_id, conversation_id, text, updated_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(shop_id, conversation_id) DO UPDATE SET
  text = excluded.text,
  updated_at = excluded.updated_at
`)
      .run(draft.shopId, draft.conversationId, draft.text, draft.updatedAt);
  }

  async getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null> {
    const database = this.#requireDatabase();
    const row = database
      .prepare(`
SELECT shop_id, conversation_id, text, updated_at
FROM whatsapp_drafts
WHERE shop_id = ? AND conversation_id = ?
`)
      .get(shopId, conversationId) as DraftRow | undefined;
    if (row === undefined) return null;
    return {
      shopId: row.shop_id as ShopId,
      conversationId: row.conversation_id,
      text: row.text,
      updatedAt: instant(row.updated_at),
    };
  }

  async close(): Promise<void> {
    const database = this.#database;
    this.#database = null;
    database?.close();
  }

  #requireDatabase(): DatabaseSync {
    if (this.#database === null) {
      throw new Error('SqliteWhatsAppStore must be initialized before use.');
    }
    return this.#database;
  }
}
