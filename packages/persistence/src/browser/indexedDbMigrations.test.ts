import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyIndexedDbMigrations,
  INDEXED_DB_STORES,
  INDEXED_DB_VERSION,
  indexedDbMigrationVersions,
} from './indexedDbMigrations';

const createdDatabases = new Set<string>();

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
        event.newVersion ?? 0,
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

afterEach(async () => {
  const names = [...createdDatabases];
  createdDatabases.clear();
  await Promise.all(names.map(deleteDatabase));
});

describe('IndexedDB migration registry', () => {
  it('declares a contiguous production migration chain', () => {
    expect(indexedDbMigrationVersions()).toEqual([1, 2]);
    expect(INDEXED_DB_VERSION).toBe(2);
  });

  it('creates every production store and v2 operational index on a fresh install', async () => {
    const name = `tux-indexeddb-fresh-${crypto.randomUUID()}`;
    const database = await openAtVersion(name, INDEXED_DB_VERSION);
    try {
      expect([...database.objectStoreNames]).toEqual(
        expect.arrayContaining([...INDEXED_DB_STORES]),
      );
      const transaction = database.transaction(
        ['orders', 'inventoryItems', 'inventoryMovements', 'outboxEvents', 'workerSessions'],
        'readonly',
      );
      expect([...transaction.objectStore('orders').indexNames]).toContain('businessDayCreatedAt');
      expect([...transaction.objectStore('inventoryItems').indexNames]).toContain('shopId');
      expect([...transaction.objectStore('inventoryMovements').indexNames]).toEqual(
        expect.arrayContaining(['itemCreatedAt', 'orderCreatedAt', 'compensatesMovementId']),
      );
      expect([...transaction.objectStore('outboxEvents').indexNames]).toEqual(
        expect.arrayContaining(['createdAt', 'aggregateStream']),
      );
      expect([...transaction.objectStore('workerSessions').indexNames]).toContain('businessDayId');
    } finally {
      database.close();
    }
  });

  it('upgrades a populated v1 database to v2 without destroying business data', async () => {
    const name = `tux-indexeddb-upgrade-${crypto.randomUUID()}`;
    const v1 = await openAtVersion(name, 1);
    const shopId = '10000000-0000-4000-8000-000000000001';
    const businessDayId = '20000000-0000-4000-8000-000000000001';
    const orderId = '30000000-0000-4000-8000-000000000001';
    const inventoryItemId = '40000000-0000-4000-8000-000000000001';
    const movementId = '50000000-0000-4000-8000-000000000001';
    const eventId = '60000000-0000-4000-8000-000000000001';
    const createdAt = '2026-08-20T03:00:00.000Z';

    const write = v1.transaction(
      ['shops', 'orders', 'inventoryItems', 'inventoryMovements', 'outboxEvents'],
      'readwrite',
    );
    write.objectStore('shops').put({ id: shopId, name: 'Persisted Shop', active: true });
    write.objectStore('orders').put({
      id: orderId,
      shopId,
      businessDayId,
      idempotencyKey: 'persisted-order',
      status: 'ACTIVE',
      createdAt,
    });
    write.objectStore('inventoryItems').put({
      id: inventoryItemId,
      shopId,
      name: 'Persisted Patty',
      unitLabel: 'piece',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
    write.objectStore('inventoryMovements').put({
      id: movementId,
      shopId,
      businessDayId,
      itemId: inventoryItemId,
      movementType: 'ORDER_CONSUMPTION',
      quantityDeltaMicros: -1_000_000,
      idempotencyKey: 'persisted-movement',
      workerId: '70000000-0000-4000-8000-000000000001',
      orderId,
      createdAt,
      compensatesMovementId: null,
    });
    write.objectStore('outboxEvents').put({
      id: eventId,
      shopId,
      businessDayId,
      aggregateType: 'ORDER',
      aggregateId: orderId,
      eventType: 'ORDER_PLACED',
      idempotencyKey: 'persisted-event',
      payloadVersion: 1,
      payload: {},
      createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
      aggregateRevision: 0,
    });
    await transactionDone(write);
    v1.close();

    const v2 = await openAtVersion(name, INDEXED_DB_VERSION);
    try {
      expect(v2.version).toBe(2);
      const read = v2.transaction(
        ['shops', 'orders', 'inventoryItems', 'inventoryMovements', 'outboxEvents'],
        'readonly',
      );
      await expect(requestResult(read.objectStore('shops').get(shopId))).resolves.toMatchObject({
        id: shopId,
        name: 'Persisted Shop',
      });
      await expect(requestResult(read.objectStore('orders').get(orderId))).resolves.toMatchObject({
        id: orderId,
        idempotencyKey: 'persisted-order',
      });
      await expect(
        requestResult(read.objectStore('inventoryItems').index('shopId').get(inventoryItemId)),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(read.objectStore('inventoryItems').index('shopId').getAll(shopId)),
      ).resolves.toHaveLength(1);
      await expect(
        requestResult(read.objectStore('inventoryMovements').index('itemCreatedAt').getAll()),
      ).resolves.toHaveLength(1);
      await expect(
        requestResult(read.objectStore('outboxEvents').index('aggregateStream').getAll()),
      ).resolves.toHaveLength(1);
    } finally {
      v2.close();
    }
  });

  it('refuses to silently skip a missing migration version', () => {
    expect(() =>
      applyIndexedDbMigrations(
        {} as IDBDatabase,
        {} as IDBTransaction,
        INDEXED_DB_VERSION,
        INDEXED_DB_VERSION + 1,
      ),
    ).toThrow('IndexedDB migration v3 is missing');
  });
});
