import 'fake-indexeddb/auto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { instant, parseEntityId, type ShopId } from '@tux/domain';
import { IndexedDbOnlineOrderInboxStore } from './browser/IndexedDbOnlineOrderInboxStore';
import type { CachedOnlineOrderRequest } from './onlineOrderInboxStore';
import { SqliteOnlineOrderInboxStore } from './sqlite/SqliteOnlineOrderInboxStore';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const otherShopId = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const requestId = '33333333-3333-4333-8333-333333333333';
const secondRequestId = '44444444-4444-4444-8444-444444444444';
const processingOrderId = '55555555-5555-4555-8555-555555555555';
const directories: string[] = [];
const indexedDbNames = new Set<string>();

function pending(
  id = requestId,
  requestShopId = shopId,
  createdAt = '2026-09-08T10:00:00.000Z',
): CachedOnlineOrderRequest {
  return {
    requestId: id,
    shopId: requestShopId,
    status: 'PENDING',
    catalogRevision: 'a'.repeat(64),
    fulfillmentPreference: 'DELIVERY',
    paymentPreference: 'CASH',
    customerName: 'Ahmed Mohamed',
    normalizedPhone: '01001234567',
    deliveryAddress: 'Nasr City, Cairo',
    trustedItems: [
      {
        productId: '66666666-6666-4666-8666-666666666666',
        productName: 'TUX Burger',
        unitPriceMinor: 19_000,
        quantity: 1,
        modifiers: [],
        comboBeverage: null,
        note: null,
      },
    ],
    itemsSubtotalMinor: 19_000,
    orderNote: null,
    createdAt: instant(createdAt),
    processingOrderId: null,
    processingStartedAt: null,
    processingExpiresAt: null,
  };
}

function processing(): CachedOnlineOrderRequest {
  return {
    ...pending(),
    status: 'PROCESSING',
    processingOrderId,
    processingStartedAt: instant('2026-09-08T10:05:00.000Z'),
    processingExpiresAt: instant('2026-09-08T22:05:00.000Z'),
  };
}

function sqlitePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'tux-online-inbox-'));
  directories.push(directory);
  return join(directory, 'inbox.sqlite3');
}

function indexedDbName(): string {
  const name = `tux-online-inbox-${crypto.randomUUID()}`;
  indexedDbNames.add(name);
  return name;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const name of indexedDbNames) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  }
  indexedDbNames.clear();
});

describe('SqliteOnlineOrderInboxStore', () => {
  it('persists an omission-safe, idempotent, shop-scoped pending request projection across restart', async () => {
    const path = sqlitePath();
    const store = new SqliteOnlineOrderInboxStore(path);
    await store.initialize();
    await store.upsertMany([pending(), pending(requestId, otherShopId)]);
    await store.upsertMany([processing()]);

    expect(await store.list(shopId)).toEqual([processing()]);
    expect((await store.list(otherShopId)).map((request) => request.shopId)).toEqual([otherShopId]);
    await store.close();

    const reopened = new SqliteOnlineOrderInboxStore(path);
    await reopened.initialize();
    await reopened.upsertMany([pending(secondRequestId, shopId, '2026-09-08T10:10:00.000Z')]);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toEqual([
      requestId,
      secondRequestId,
    ]);

    await reopened.remove(otherShopId, requestId);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toContain(requestId);
    await reopened.remove(shopId, requestId);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toEqual([
      secondRequestId,
    ]);
    await reopened.close();
  });
});

describe('IndexedDbOnlineOrderInboxStore', () => {
  it('persists an omission-safe, idempotent, shop-scoped pending request projection across restart', async () => {
    const name = indexedDbName();
    const store = new IndexedDbOnlineOrderInboxStore(name);
    await store.initialize();
    await store.upsertMany([pending(), pending(requestId, otherShopId)]);
    await store.upsertMany([processing()]);

    expect(await store.list(shopId)).toEqual([processing()]);
    expect((await store.list(otherShopId)).map((request) => request.shopId)).toEqual([otherShopId]);
    await store.close();

    const reopened = new IndexedDbOnlineOrderInboxStore(name);
    await reopened.initialize();
    await reopened.upsertMany([pending(secondRequestId, shopId, '2026-09-08T10:10:00.000Z')]);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toEqual([
      requestId,
      secondRequestId,
    ]);

    await reopened.remove(otherShopId, requestId);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toContain(requestId);
    await reopened.remove(shopId, requestId);
    expect((await reopened.list(shopId)).map((request) => request.requestId)).toEqual([
      secondRequestId,
    ]);
    await reopened.close();
  });
});

describe('accepted online-order tombstones', () => {
  it('SQLite keeps a locally accepted request hidden across restart and remote re-upsert', async () => {
    const path = sqlitePath();
    const store = new SqliteOnlineOrderInboxStore(path);
    await store.initialize();
    await store.upsertMany([processing()]);
    await store.markAccepted(shopId, requestId, processingOrderId);
    expect(await store.get(shopId, requestId)).toBeNull();
    expect(await store.list(shopId)).toEqual([]);
    await store.close();

    const reopened = new SqliteOnlineOrderInboxStore(path);
    await reopened.initialize();
    await reopened.upsertMany([processing()]);
    expect(await reopened.get(shopId, requestId)).toBeNull();
    expect(await reopened.list(shopId)).toEqual([]);
    await reopened.close();
  });

  it('IndexedDB keeps a locally accepted request hidden across restart and remote re-upsert', async () => {
    const name = indexedDbName();
    const store = new IndexedDbOnlineOrderInboxStore(name);
    await store.initialize();
    await store.upsertMany([processing()]);
    await store.markAccepted(shopId, requestId, processingOrderId);
    expect(await store.get(shopId, requestId)).toBeNull();
    expect(await store.list(shopId)).toEqual([]);
    await store.close();

    const reopened = new IndexedDbOnlineOrderInboxStore(name);
    await reopened.initialize();
    await reopened.upsertMany([processing()]);
    expect(await reopened.get(shopId, requestId)).toBeNull();
    expect(await reopened.list(shopId)).toEqual([]);
    await reopened.close();
  });
});
