import 'fake-indexeddb/auto';
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbWhatsAppStore } from './IndexedDbWhatsAppStore';
import {
  applyIndexedDbMigrations,
  INDEXED_DB_VERSION,
  indexedDbMigrationVersions,
} from './indexedDbMigrations';

const SHOP_A = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const SHOP_B = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const ORDER_A = parseEntityId<OrderId>('33333333-3333-4333-8333-333333333333');
const ORDER_B = parseEntityId<OrderId>('44444444-4444-4444-8444-444444444444');
const createdDatabases = new Set<string>();

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

function openAtVersion(name: string, version: number): Promise<IDBDatabase> {
  createdDatabases.add(name);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.addEventListener('upgradeneeded', (event) => {
      const transaction = request.transaction;
      if (transaction === null) {
        reject(new Error('IndexedDB upgrade transaction was unavailable.'));
        return;
      }
      applyIndexedDbMigrations(
        request.result,
        transaction,
        event.oldVersion,
        event.newVersion ?? version,
      );
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB open failed.')),
      { once: true },
    );
  });
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener('success', () => resolve(), { once: true });
    request.addEventListener(
      'blocked',
      () => reject(new Error(`IndexedDB delete blocked: ${name}`)),
      {
        once: true,
      },
    );
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error(`Could not delete IndexedDB ${name}.`)),
      { once: true },
    );
  });
}

function databaseName(label: string): string {
  const name = `tux-whatsapp-indexeddb-${label}-${crypto.randomUUID()}`;
  createdDatabases.add(name);
  return name;
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
    media: null,
    location: null,
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

afterEach(async () => {
  vi.unstubAllGlobals();
  const names = [...createdDatabases];
  createdDatabases.clear();
  await Promise.all(names.map(deleteDatabase));
});

describe('IndexedDbWhatsAppStore', () => {
  it('upgrades an existing Operations v4 database to v5 without losing Operations data', async () => {
    const name = databaseName('upgrade');
    const v4 = await openAtVersion(name, 4);
    const write = v4.transaction(['shops'], 'readwrite');
    write.objectStore('shops').put({ id: SHOP_A, name: 'Existing shop', active: true });
    await transactionDone(write);
    v4.close();

    const store = new IndexedDbWhatsAppStore(name);
    await store.initialize();
    await store.close();

    const latest = await openAtVersion(name, 5);
    try {
      expect(latest.version).toBe(5);
      const read = latest.transaction(['shops'], 'readonly');
      await expect(requestResult(read.objectStore('shops').get(SHOP_A))).resolves.toMatchObject({
        id: SHOP_A,
        name: 'Existing shop',
      });
    } finally {
      latest.close();
    }
  });

  it('declares migration v5 and creates deterministic WhatsApp stores and indexes', async () => {
    expect(INDEXED_DB_VERSION).toBe(5);
    expect(indexedDbMigrationVersions()).toEqual([1, 2, 3, 4, 5]);
    const name = databaseName('schema');
    const database = await openAtVersion(name, 5);
    try {
      expect([...database.objectStoreNames]).toEqual(
        expect.arrayContaining([
          'whatsappConversations',
          'whatsappMessages',
          'whatsappQuickReplies',
          'whatsappOrderLinks',
          'whatsappDrafts',
        ]),
      );
      const transaction = database.transaction(
        ['whatsappConversations', 'whatsappMessages', 'whatsappQuickReplies', 'whatsappOrderLinks'],
        'readonly',
      );
      expect([...transaction.objectStore('whatsappConversations').indexNames]).toEqual([
        'shopLastMessage',
      ]);
      expect([...transaction.objectStore('whatsappMessages').indexNames]).toEqual([
        'shopConversationCreated',
      ]);
      expect([...transaction.objectStore('whatsappQuickReplies').indexNames]).toEqual(['shopId']);
      expect([...transaction.objectStore('whatsappOrderLinks').indexNames]).toEqual([
        'shopConversation',
      ]);
    } finally {
      database.close();
    }
  });

  it('upserts remote snapshots idempotently and retains cached history omitted from later pages', async () => {
    const store = new IndexedDbWhatsAppStore(databaseName('upsert'));
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
    const messages = await store.listMessages(SHOP_A, 'conversation-a');
    expect(messages.map((entry) => entry.id)).toEqual(['message-old', 'message-current']);
    expect(messages[1]?.text).toBe('Updated message');
    await store.close();
  });

  it('fences cached inbox data by shop', async () => {
    const store = new IndexedDbWhatsAppStore(databaseName('fence'));
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

    const cached = await store.loadInbox(SHOP_A);
    expect(cached.conversations.map((entry) => entry.id)).toEqual(['conversation-a']);
    expect(cached.messages.map((entry) => entry.id)).toEqual(['message-a']);
    expect(cached.quickReplies.map((entry) => entry.id)).toEqual(['reply-a']);
    expect(cached.orderLinks.map((entry) => entry.orderId)).toEqual([ORDER_A]);
    expect(await store.listMessages(SHOP_A, 'conversation-b')).toEqual([]);
    await store.close();
  });

  it('orders messages by createdAt and then durable message ID', async () => {
    const store = new IndexedDbWhatsAppStore(databaseName('ordering'));
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

  it('persists drafts across close and reopen and fences them by shop plus conversation', async () => {
    const name = databaseName('draft');
    const first = new IndexedDbWhatsAppStore(name);
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

    const reopened = new IndexedDbWhatsAppStore(name);
    await reopened.initialize();
    expect((await reopened.getDraft(SHOP_A, 'conversation-a'))?.text).toBe('Draft A');
    expect((await reopened.getDraft(SHOP_B, 'conversation-a'))?.text).toBe('Draft B');
    expect(await reopened.getDraft(SHOP_A, 'conversation-missing')).toBeNull();
    await reopened.close();
  });

  it('upserts a single durable message without duplicating it', async () => {
    const store = new IndexedDbWhatsAppStore(databaseName('message'));
    await store.initialize();
    const original = message(SHOP_A, 'conversation-a', 'message-a', '2026-09-03T08:00:00.000Z');
    await store.upsertMessage(original);
    await store.upsertMessage({ ...original, text: 'Updated' });
    const messages = await store.listMessages(SHOP_A, 'conversation-a');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe('Updated');
    await store.close();
  });

  it('treats persistent-storage requests as best-effort only', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('persistence denied'));
    vi.stubGlobal('navigator', { storage: { persist } });
    const store = new IndexedDbWhatsAppStore(databaseName('persist'));
    await expect(store.initialize()).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
    await store.close();
  });
});
