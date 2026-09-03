import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  instant,
  parseEntityId,
  type OrderId,
  type ShopId,
  type WhatsAppConversation,
  type WhatsAppMessage,
  type WhatsAppQuickReply,
} from '@tux/domain';
import type { CachedWhatsAppInboxSnapshot } from '../whatsappStore';
import { afterEach, describe, expect, it } from 'vitest';
import { SQLITE_MIGRATIONS } from './migrations';
import { SqliteWhatsAppStore } from './SqliteWhatsAppStore';

const SHOP_A = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const SHOP_B = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const ORDER_A = parseEntityId<OrderId>('33333333-3333-4333-8333-333333333333');
const ORDER_B = parseEntityId<OrderId>('44444444-4444-4444-8444-444444444444');

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function databasePath(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tux-whatsapp-sqlite-'));
  roots.push(root);
  return join(root, `${name}.sqlite`);
}

function conversation(
  shopId: ShopId,
  id: string,
  lastMessageAt: string | null,
  unreadCount = 0,
): WhatsAppConversation {
  return {
    id,
    shopId,
    normalizedPhone: '01012345678',
    displayPhone: '+201012345678',
    customerName: 'Customer',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount,
    archived: false,
    followUp: false,
    lastMessageAt: lastMessageAt === null ? null : instant(lastMessageAt),
  };
}

function message(
  shopId: ShopId,
  conversationId: string,
  id: string,
  createdAt: string,
  text = id,
): WhatsAppMessage {
  return {
    id,
    shopId,
    conversationId,
    providerMessageId: `provider-${id}`,
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'TEXT',
    text,
    mediaRef: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: instant(createdAt),
  };
}

function quickReply(shopId: ShopId, id: string, text = id): WhatsAppQuickReply {
  return {
    id,
    shopId,
    category: 'THANKS',
    language: 'ar-EG',
    text,
    usageCount: 0,
    active: true,
  };
}

function snapshot(input: {
  conversations?: readonly WhatsAppConversation[];
  messages?: readonly WhatsAppMessage[];
  quickReplies?: readonly WhatsAppQuickReply[];
  orderLinks?: CachedWhatsAppInboxSnapshot['orderLinks'];
}): CachedWhatsAppInboxSnapshot {
  return {
    conversations: input.conversations ?? [],
    messages: input.messages ?? [],
    quickReplies: input.quickReplies ?? [],
    orderLinks: input.orderLinks ?? [],
  };
}

function createV9Database(path: string): void {
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec(`
CREATE TABLE local_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  for (const migration of SQLITE_MIGRATIONS.filter((candidate) => candidate.version <= 9)) {
    database.exec(migration.sql);
    database
      .prepare('INSERT INTO local_schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, '2026-09-03T00:00:00.000Z');
  }
  database
    .prepare('INSERT INTO shops(id, name, active, payload_json) VALUES (?, ?, ?, ?)')
    .run(
      SHOP_A,
      'Existing shop',
      1,
      JSON.stringify({ id: SHOP_A, name: 'Existing shop', active: true }),
    );
  database.close();
}

describe('SqliteWhatsAppStore', () => {
  it('requires initialize before use', async () => {
    const store = new SqliteWhatsAppStore(await databasePath('initialize'));
    await expect(store.loadInbox(SHOP_A)).rejects.toThrow(/initialized/i);
    await store.close();
  });

  it('upserts remote snapshots idempotently by durable IDs without deleting omitted history', async () => {
    const store = new SqliteWhatsAppStore(await databasePath('upsert'));
    await store.initialize();
    const first = snapshot({
      conversations: [conversation(SHOP_A, 'conversation-a', '2026-09-03T08:00:00.000Z', 1)],
      messages: [
        message(SHOP_A, 'conversation-a', 'message-old', '2026-09-03T07:00:00.000Z'),
        message(SHOP_A, 'conversation-a', 'message-current', '2026-09-03T08:00:00.000Z'),
      ],
      quickReplies: [quickReply(SHOP_A, 'reply-a', 'Old reply')],
      orderLinks: [
        {
          conversationId: 'conversation-a',
          orderId: ORDER_A,
          linkedAt: instant('2026-09-03T08:01:00.000Z'),
        },
      ],
    });
    await store.upsertRemoteSnapshot(first);
    await store.upsertRemoteSnapshot(first);
    await store.upsertRemoteSnapshot(
      snapshot({
        conversations: [conversation(SHOP_A, 'conversation-a', '2026-09-03T09:00:00.000Z', 7)],
        messages: [
          message(
            SHOP_A,
            'conversation-a',
            'message-current',
            '2026-09-03T08:00:00.000Z',
            'Updated message',
          ),
        ],
        quickReplies: [quickReply(SHOP_A, 'reply-a', 'Updated reply')],
        orderLinks: [
          {
            conversationId: 'conversation-a',
            orderId: ORDER_A,
            linkedAt: instant('2026-09-03T09:01:00.000Z'),
          },
        ],
      }),
    );

    const cached = await store.loadInbox(SHOP_A);
    expect(cached.conversations).toHaveLength(1);
    expect(cached.conversations[0]?.unreadCount).toBe(7);
    expect(cached.quickReplies).toHaveLength(1);
    expect(cached.quickReplies[0]?.text).toBe('Updated reply');
    expect(cached.orderLinks).toEqual([
      {
        conversationId: 'conversation-a',
        orderId: ORDER_A,
        linkedAt: instant('2026-09-03T09:01:00.000Z'),
      },
    ]);
    expect((await store.listMessages(SHOP_A, 'conversation-a')).map((entry) => entry.id)).toEqual([
      'message-old',
      'message-current',
    ]);
    expect((await store.listMessages(SHOP_A, 'conversation-a'))[1]?.text).toBe('Updated message');
    await store.close();
  });

  it('orders messages by createdAt and then durable message ID', async () => {
    const store = new SqliteWhatsAppStore(await databasePath('ordering'));
    await store.initialize();
    await store.upsertRemoteSnapshot(
      snapshot({
        conversations: [conversation(SHOP_A, 'conversation-a', '2026-09-03T10:00:00.000Z')],
        messages: [
          message(SHOP_A, 'conversation-a', 'message-z', '2026-09-03T10:00:00.000Z'),
          message(SHOP_A, 'conversation-a', 'message-b', '2026-09-03T09:00:00.000Z'),
          message(SHOP_A, 'conversation-a', 'message-a', '2026-09-03T09:00:00.000Z'),
        ],
      }),
    );
    expect((await store.listMessages(SHOP_A, 'conversation-a')).map((entry) => entry.id)).toEqual([
      'message-a',
      'message-b',
      'message-z',
    ]);
    await store.close();
  });

  it('fences cached snapshots and messages by shop', async () => {
    const store = new SqliteWhatsAppStore(await databasePath('fence'));
    await store.initialize();
    await store.upsertRemoteSnapshot(
      snapshot({
        conversations: [
          conversation(SHOP_A, 'conversation-a', '2026-09-03T08:00:00.000Z'),
          conversation(SHOP_B, 'conversation-b', '2026-09-03T09:00:00.000Z'),
        ],
        messages: [
          message(SHOP_A, 'conversation-a', 'message-a', '2026-09-03T08:00:00.000Z'),
          message(SHOP_B, 'conversation-b', 'message-b', '2026-09-03T09:00:00.000Z'),
        ],
        quickReplies: [quickReply(SHOP_A, 'reply-a'), quickReply(SHOP_B, 'reply-b')],
        orderLinks: [
          {
            conversationId: 'conversation-a',
            orderId: ORDER_A,
            linkedAt: instant('2026-09-03T08:01:00.000Z'),
          },
          {
            conversationId: 'conversation-b',
            orderId: ORDER_B,
            linkedAt: instant('2026-09-03T09:01:00.000Z'),
          },
        ],
      }),
    );

    const a = await store.loadInbox(SHOP_A);
    expect(a.conversations.map((entry) => entry.id)).toEqual(['conversation-a']);
    expect(a.messages.map((entry) => entry.id)).toEqual(['message-a']);
    expect(a.quickReplies.map((entry) => entry.id)).toEqual(['reply-a']);
    expect(a.orderLinks.map((entry) => entry.orderId)).toEqual([ORDER_A]);
    expect(await store.listMessages(SHOP_A, 'conversation-b')).toEqual([]);
    await store.close();
  });

  it('persists drafts across close and reopen and fences them by shop plus conversation', async () => {
    const path = await databasePath('draft');
    const first = new SqliteWhatsAppStore(path);
    await first.initialize();
    await first.saveDraft({
      shopId: SHOP_A,
      conversationId: 'conversation-a',
      text: 'Draft A',
      updatedAt: instant('2026-09-03T10:00:00.000Z'),
    });
    await first.saveDraft({
      shopId: SHOP_B,
      conversationId: 'conversation-a',
      text: 'Draft B',
      updatedAt: instant('2026-09-03T10:01:00.000Z'),
    });
    await first.close();

    const reopened = new SqliteWhatsAppStore(path);
    await reopened.initialize();
    expect((await reopened.getDraft(SHOP_A, 'conversation-a'))?.text).toBe('Draft A');
    expect((await reopened.getDraft(SHOP_B, 'conversation-a'))?.text).toBe('Draft B');
    expect(await reopened.getDraft(SHOP_A, 'conversation-missing')).toBeNull();
    await reopened.close();
  });

  it('upserts a single durable message without duplicating it', async () => {
    const store = new SqliteWhatsAppStore(await databasePath('message'));
    await store.initialize();
    const original = message(SHOP_A, 'conversation-a', 'message-a', '2026-09-03T08:00:00.000Z');
    await store.upsertMessage(original);
    await store.upsertMessage({ ...original, text: 'Updated' });
    const messages = await store.listMessages(SHOP_A, 'conversation-a');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('Updated');
    await store.close();
  });

  it('upgrades an existing Operations v9 database in place without losing Operations data', async () => {
    const path = await databasePath('upgrade');
    createV9Database(path);

    const store = new SqliteWhatsAppStore(path);
    await store.initialize();
    await store.close();

    const database = new DatabaseSync(path);
    expect(database.prepare('SELECT name FROM shops WHERE id = ?').get(SHOP_A)).toEqual({
      name: 'Existing shop',
    });
    expect(
      database.prepare('SELECT name FROM local_schema_migrations WHERE version = 10').get(),
    ).toEqual({
      name: 'whatsapp_local_cache',
    });
    database.close();
  });

  it('rejects malformed cached WhatsApp message payloads on read', async () => {
    const path = await databasePath('malformed-message');
    const store = new SqliteWhatsAppStore(path);
    await store.initialize();
    await store.close();

    const database = new DatabaseSync(path);
    database
      .prepare(
        `
INSERT INTO whatsapp_cache_messages(id, shop_id, conversation_id, created_at, payload_json)
VALUES (?, ?, ?, ?, ?)
`,
      )
      .run(
        'malformed-message',
        SHOP_A,
        'conversation-a',
        '2026-09-03T11:00:00.000Z',
        JSON.stringify({ id: 'malformed-message', shopId: SHOP_A }),
      );
    database.close();

    const reopened = new SqliteWhatsAppStore(path);
    await reopened.initialize();
    await expect(reopened.loadInbox(SHOP_A)).rejects.toThrow();
    await reopened.close();
  });

  it('rejects cached conversation payloads whose tenant identity disagrees with the fenced row', async () => {
    const path = await databasePath('tenant-mismatch');
    const store = new SqliteWhatsAppStore(path);
    await store.initialize();
    await store.close();

    const database = new DatabaseSync(path);
    database
      .prepare(
        `
INSERT INTO whatsapp_cache_conversations(id, shop_id, last_message_at, payload_json)
VALUES (?, ?, ?, ?)
`,
      )
      .run(
        'conversation-a',
        SHOP_A,
        '2026-09-03T11:00:00.000Z',
        JSON.stringify(conversation(SHOP_B, 'conversation-a', '2026-09-03T11:00:00.000Z')),
      );
    database.close();

    const reopened = new SqliteWhatsAppStore(path);
    await reopened.initialize();
    await expect(reopened.loadInbox(SHOP_A)).rejects.toThrow(/shop|tenant/i);
    await reopened.close();
  });
});
