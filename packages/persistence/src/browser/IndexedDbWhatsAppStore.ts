import { instant } from '@tux/domain';
import type {
  ShopId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';
import { sanitizeWhatsAppMessageForCache } from '../whatsappCacheSanitization';
import type { CachedWhatsAppInboxSnapshot, WhatsAppDraft, WhatsAppStore } from '../whatsappStore';
import { openOperationsIndexedDb } from './openOperationsIndexedDb';

interface StoredOrderLink {
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly orderId: CachedWhatsAppInboxSnapshot['orderLinks'][number]['orderId'];
  readonly linkedAt: CachedWhatsAppInboxSnapshot['orderLinks'][number]['linkedAt'];
}

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    );
  });
}

function record(value: unknown, kind: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Cached WhatsApp ${kind} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseConversation(value: unknown, expectedShopId: ShopId): WhatsAppConversation {
  const data = record(value, 'conversation');
  if (data['shopId'] !== expectedShopId || typeof data['id'] !== 'string') {
    throw new Error('Cached WhatsApp conversation identity does not match the tenant fence.');
  }
  return data as unknown as WhatsAppConversation;
}

function parseMessage(
  value: unknown,
  expectedShopId: ShopId,
  expectedConversationId?: string,
): WhatsAppMessage {
  const data = record(value, 'message');
  if (
    data['shopId'] !== expectedShopId ||
    typeof data['id'] !== 'string' ||
    typeof data['conversationId'] !== 'string' ||
    (expectedConversationId !== undefined && data['conversationId'] !== expectedConversationId)
  ) {
    throw new Error('Cached WhatsApp message identity does not match the tenant fence.');
  }
  return sanitizeWhatsAppMessageForCache(data as unknown as WhatsAppMessage);
}

function parseQuickReply(value: unknown, expectedShopId: ShopId): WhatsAppQuickReply {
  const data = record(value, 'quick reply');
  if (data['shopId'] !== expectedShopId || typeof data['id'] !== 'string') {
    throw new Error('Cached WhatsApp quick reply identity does not match the tenant fence.');
  }
  return data as unknown as WhatsAppQuickReply;
}

function parseOrderLink(
  value: unknown,
  expectedShopId: ShopId,
): CachedWhatsAppInboxSnapshot['orderLinks'][number] {
  const data = record(value, 'order link');
  if (
    data['shopId'] !== expectedShopId ||
    typeof data['conversationId'] !== 'string' ||
    typeof data['orderId'] !== 'string' ||
    typeof data['linkedAt'] !== 'string'
  ) {
    throw new Error('Cached WhatsApp order link identity does not match the tenant fence.');
  }
  return {
    conversationId: data['conversationId'],
    orderId: data['orderId'] as StoredOrderLink['orderId'],
    linkedAt: instant(data['linkedAt']),
  };
}

export class IndexedDbWhatsAppStore implements WhatsAppStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openOperationsIndexedDb(this.#name);
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist !== undefined) {
        await navigator.storage.persist();
      }
    } catch {
      // Persistent storage is best-effort; IndexedDB correctness does not depend on the browser grant.
    }
  }

  async upsertRemoteSnapshot(snapshot: CachedWhatsAppInboxSnapshot): Promise<void> {
    const database = this.#requireDatabase();
    const conversationShops = new Map(
      snapshot.conversations.map((conversation) => [conversation.id, conversation.shopId] as const),
    );

    const missingConversationIds = [
      ...new Set(
        snapshot.orderLinks
          .map((link) => link.conversationId)
          .filter((conversationId) => !conversationShops.has(conversationId)),
      ),
    ];
    if (missingConversationIds.length > 0) {
      const read = database.transaction(['whatsappConversations'], 'readonly');
      const completion = transactionDone(read);
      const store = read.objectStore('whatsappConversations');
      const requests = missingConversationIds.map(async (conversationId) => {
        const value = await requestResult(store.get(conversationId));
        if (value === undefined) return;
        const data = record(value, 'conversation');
        if (typeof data['shopId'] === 'string') {
          conversationShops.set(conversationId, data['shopId'] as ShopId);
        }
      });
      await Promise.all(requests);
      await completion;
    }

    const safeMessages = snapshot.messages.map(sanitizeWhatsAppMessageForCache);
    for (const link of snapshot.orderLinks) {
      if (!conversationShops.has(link.conversationId)) {
        throw new Error(
          `Cannot cache WhatsApp order link without a tenant-fenced conversation: ${link.conversationId}`,
        );
      }
    }

    const transaction = database.transaction(
      ['whatsappConversations', 'whatsappMessages', 'whatsappQuickReplies', 'whatsappOrderLinks'],
      'readwrite',
      { durability: 'strict' },
    );
    const completion = transactionDone(transaction);
    const conversations = transaction.objectStore('whatsappConversations');
    const messages = transaction.objectStore('whatsappMessages');
    const quickReplies = transaction.objectStore('whatsappQuickReplies');
    const orderLinks = transaction.objectStore('whatsappOrderLinks');
    const writes: Promise<unknown>[] = [];
    for (const conversation of snapshot.conversations) {
      writes.push(requestResult(conversations.put(conversation)));
    }
    for (const message of safeMessages) {
      writes.push(requestResult(messages.put(message)));
    }
    for (const quickReply of snapshot.quickReplies) {
      writes.push(requestResult(quickReplies.put(quickReply)));
    }
    for (const link of snapshot.orderLinks) {
      const shopId = conversationShops.get(link.conversationId);
      if (shopId === undefined) {
        throw new Error(
          `Cannot cache WhatsApp order link without a tenant-fenced conversation: ${link.conversationId}`,
        );
      }
      writes.push(
        requestResult(
          orderLinks.put({
            shopId,
            conversationId: link.conversationId,
            orderId: link.orderId,
            linkedAt: link.linkedAt,
          } satisfies StoredOrderLink),
        ),
      );
    }
    try {
      await Promise.all(writes);
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be complete.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async upsertMessage(message: WhatsAppMessage): Promise<void> {
    const safeMessage = sanitizeWhatsAppMessageForCache(message);
    const database = this.#requireDatabase();
    const transaction = database.transaction(['whatsappMessages'], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore('whatsappMessages').put(safeMessage));
    await completion;
  }

  async loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(
      ['whatsappConversations', 'whatsappMessages', 'whatsappQuickReplies', 'whatsappOrderLinks'],
      'readonly',
    );
    const completion = transactionDone(transaction);
    const conversationRequest = transaction.objectStore('whatsappConversations').getAll();
    const messageRequest = transaction.objectStore('whatsappMessages').getAll();
    const quickReplyRequest = transaction.objectStore('whatsappQuickReplies').getAll();
    const orderLinkRequest = transaction.objectStore('whatsappOrderLinks').getAll();
    const [rawConversations, rawMessages, rawQuickReplies, rawOrderLinks] = await Promise.all([
      requestResult(conversationRequest),
      requestResult(messageRequest),
      requestResult(quickReplyRequest),
      requestResult(orderLinkRequest),
    ]);
    await completion;

    const conversations = rawConversations
      .filter((value) => record(value, 'conversation')['shopId'] === shopId)
      .map((value) => parseConversation(value, shopId))
      .sort(
        (left, right) =>
          (right.lastMessageAt ?? '').localeCompare(left.lastMessageAt ?? '') ||
          left.id.localeCompare(right.id),
      );
    const messages = rawMessages
      .filter((value) => record(value, 'message')['shopId'] === shopId)
      .map((value) => parseMessage(value, shopId))
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
    const quickReplies = rawQuickReplies
      .filter((value) => record(value, 'quick reply')['shopId'] === shopId)
      .map((value) => parseQuickReply(value, shopId))
      .sort((left, right) => left.id.localeCompare(right.id));
    const orderLinks = rawOrderLinks
      .filter((value) => record(value, 'order link')['shopId'] === shopId)
      .map((value) => parseOrderLink(value, shopId))
      .sort(
        (left, right) =>
          left.conversationId.localeCompare(right.conversationId) ||
          left.orderId.localeCompare(right.orderId),
      );

    return { conversations, messages, quickReplies, orderLinks };
  }

  async listMessages(shopId: ShopId, conversationId: string): Promise<readonly WhatsAppMessage[]> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(['whatsappMessages'], 'readonly');
    const completion = transactionDone(transaction);
    const range = IDBKeyRange.bound(
      [shopId, conversationId, '', ''],
      [shopId, conversationId, '\uffff', '\uffff'],
    );
    const values = await requestResult(
      transaction.objectStore('whatsappMessages').index('shopConversationCreated').getAll(range),
    );
    await completion;
    return values.map((value) => parseMessage(value, shopId, conversationId));
  }

  async saveDraft(draft: WhatsAppDraft): Promise<void> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(['whatsappDrafts'], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionDone(transaction);
    await requestResult(transaction.objectStore('whatsappDrafts').put(draft));
    await completion;
  }

  async getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null> {
    const database = this.#requireDatabase();
    const transaction = database.transaction(['whatsappDrafts'], 'readonly');
    const completion = transactionDone(transaction);
    const value = await requestResult(
      transaction.objectStore('whatsappDrafts').get([shopId, conversationId]),
    );
    await completion;
    if (value === undefined) return null;
    const data = record(value, 'draft');
    if (
      data['shopId'] !== shopId ||
      data['conversationId'] !== conversationId ||
      typeof data['text'] !== 'string' ||
      typeof data['updatedAt'] !== 'string'
    ) {
      throw new Error('Cached WhatsApp draft identity does not match the requested tenant fence.');
    }
    return {
      shopId,
      conversationId,
      text: data['text'],
      updatedAt: instant(data['updatedAt']),
    };
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }

  #requireDatabase(): IDBDatabase {
    if (this.#database === null) {
      throw new Error('IndexedDbWhatsAppStore must be initialized before use.');
    }
    return this.#database;
  }
}
