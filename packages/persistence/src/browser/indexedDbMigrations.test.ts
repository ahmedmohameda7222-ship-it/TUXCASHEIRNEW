import 'fake-indexeddb/auto';
import {
  instant,
  parseEntityId,
  parseSystemAccentColor,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbOperationsDatabase } from './IndexedDbOperationsDatabase';
import {
  applyIndexedDbMigrations,
  INDEXED_DB_STORES,
  INDEXED_DB_VERSION,
  indexedDbMigrationVersions,
} from './indexedDbMigrations';

const createdDatabases = new Set<string>();

const preferenceShopId = parseEntityId<ShopId>('81111111-1111-4111-8111-111111111111');
const preferenceWorkerAId = parseEntityId<WorkerId>('82222222-2222-4222-8222-222222222221');
const preferenceWorkerBId = parseEntityId<WorkerId>('82222222-2222-4222-8222-222222222222');
const preferenceCategoryAId = parseEntityId<MenuCategoryId>('83333333-3333-4333-8333-333333333331');
const preferenceCategoryBId = parseEntityId<MenuCategoryId>('83333333-3333-4333-8333-333333333332');
const preferenceProductAId = parseEntityId<ProductId>('84444444-4444-4444-8444-444444444441');
const preferenceProductBId = parseEntityId<ProductId>('84444444-4444-4444-8444-444444444442');
const preferenceProductCId = parseEntityId<ProductId>('84444444-4444-4444-8444-444444444443');
const customAccent = parseSystemAccentColor('#1E3A8A');

function preference(workerId: WorkerId, serverVersion = 0) {
  return {
    shopId: preferenceShopId,
    workerId,
    categoryOrder: [preferenceCategoryBId, preferenceCategoryAId],
    categoryAlignment: 'right' as const,
    productOrder:
      workerId === preferenceWorkerBId
        ? [preferenceProductAId, preferenceProductBId]
        : [preferenceProductBId, preferenceProductAId],
    accentColor: null,
    updatedAt: instant('2026-08-25T02:00:00.000Z'),
    serverVersion,
    syncState: 'DIRTY' as const,
  };
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
      { once: true },
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
    expect(indexedDbMigrationVersions()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(INDEXED_DB_VERSION).toBe(10);
  });

  it('retries legacy quarantined order lifecycle events once on v10 while preserving evidence', async () => {
    const name = `tux-indexeddb-v10-order-recovery-${crypto.randomUUID()}`;
    const v9 = await openAtVersion(name, 9);
    const write = v9.transaction('outboxEvents', 'readwrite');
    const id = '60000000-0000-4000-8000-000000000011';
    write.objectStore('outboxEvents').put({
      id,
      shopId: '10000000-0000-4000-8000-000000000001',
      businessDayId: '20000000-0000-4000-8000-000000000001',
      aggregateType: 'ORDER',
      aggregateId: '30000000-0000-4000-8000-000000000001',
      aggregateRevision: 1,
      eventType: 'ORDER_MARKED_DONE',
      payloadVersion: 1,
      payload: {},
      idempotencyKey: 'legacy-order-lifecycle-v10-retry',
      createdAt: '2026-10-24T13:00:00.000Z',
      attemptCount: 1,
      nextAttemptAt: null,
      lastError: 'Remote outbox endpoint rejected event with HTTP 400.',
      deliveredAt: null,
      quarantinedAt: '2026-10-24T13:01:00.000Z',
      permanentFailureReason: 'Remote outbox endpoint rejected event with HTTP 400.',
      blockedByEventId: null,
    });
    await transactionDone(write);
    v9.close();

    const v10 = await openAtVersion(name, 10);
    try {
      await expect(
        requestResult(
          v10.transaction('outboxEvents', 'readonly').objectStore('outboxEvents').get(id),
        ),
      ).resolves.toMatchObject({
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        quarantinedAt: null,
        permanentFailureReason: null,
        recoveryEvidence: {
          quarantinedAt: '2026-10-24T13:01:00.000Z',
          reason: 'Remote outbox endpoint rejected event with HTTP 400.',
          migration: 10,
        },
      });
    } finally {
      v10.close();
    }
  });

  it('retries transient pending events once on v9 without touching quarantine evidence', async () => {
    const name = `tux-indexeddb-v9-retry-${crypto.randomUUID()}`;
    const v8 = await openAtVersion(name, 8);
    const write = v8.transaction('outboxEvents', 'readwrite');
    const pendingId = '60000000-0000-4000-8000-000000000009';
    const quarantinedId = '60000000-0000-4000-8000-000000000010';
    const base = {
      shopId: '10000000-0000-4000-8000-000000000001',
      businessDayId: '20000000-0000-4000-8000-000000000001',
      aggregateType: 'BUSINESS_DAY',
      aggregateId: '20000000-0000-4000-8000-000000000001',
      aggregateRevision: 0,
      eventType: 'RECONCILIATION_RECORDED',
      payloadVersion: 1,
      payload: {},
      createdAt: '2026-10-24T13:00:00.000Z',
      attemptCount: 7,
      nextAttemptAt: '2026-10-25T00:00:00.000Z',
      lastError: 'Remote outbox endpoint rejected event with HTTP 500.',
      deliveredAt: null,
      permanentFailureReason: null,
      blockedByEventId: null,
    };
    write.objectStore('outboxEvents').put({
      ...base,
      id: pendingId,
      idempotencyKey: 'pending-v9-retry',
      quarantinedAt: null,
    });
    write.objectStore('outboxEvents').put({
      ...base,
      id: quarantinedId,
      idempotencyKey: 'quarantined-v9-preserved',
      nextAttemptAt: null,
      quarantinedAt: '2026-10-24T13:01:00.000Z',
      permanentFailureReason: 'manual review required',
    });
    await transactionDone(write);
    v8.close();

    const v9 = await openAtVersion(name, 9);
    try {
      const read = v9.transaction('outboxEvents', 'readonly').objectStore('outboxEvents');
      await expect(requestResult(read.get(pendingId))).resolves.toMatchObject({
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        quarantinedAt: null,
      });
      await expect(requestResult(read.get(quarantinedId))).resolves.toMatchObject({
        attemptCount: 7,
        quarantinedAt: '2026-10-24T13:01:00.000Z',
        permanentFailureReason: 'manual review required',
      });
    } finally {
      v9.close();
    }
  });

  it('keeps quarantined evidence when a browser upgrades from v7 to v8', async () => {
    const name = `tux-indexeddb-v8-preservation-${crypto.randomUUID()}`;
    const v7 = await openAtVersion(name, 7);
    const write = v7.transaction('outboxEvents', 'readwrite');
    const id = '60000000-0000-4000-8000-000000000001';
    write.objectStore('outboxEvents').put({
      id,
      shopId: '10000000-0000-4000-8000-000000000001',
      businessDayId: '20000000-0000-4000-8000-000000000001',
      aggregateType: 'BUSINESS_DAY',
      aggregateId: '20000000-0000-4000-8000-000000000001',
      aggregateRevision: 0,
      eventType: 'BUSINESS_DAY_STARTED',
      payloadVersion: 1,
      payload: {},
      idempotencyKey: 'quarantine-evidence-preserved',
      createdAt: '2026-10-24T13:00:00.000Z',
      attemptCount: 1,
      nextAttemptAt: null,
      lastError: 'canonical rejection evidence',
      deliveredAt: null,
      quarantinedAt: '2026-10-24T13:01:00.000Z',
      permanentFailureReason: 'canonical rejection evidence',
      blockedByEventId: null,
    });
    await transactionDone(write);
    v7.close();

    const v8 = await openAtVersion(name, 8);
    try {
      const row = await requestResult(
        v8.transaction('outboxEvents', 'readonly').objectStore('outboxEvents').get(id),
      );
      expect(row).toMatchObject({ id, quarantinedAt: '2026-10-24T13:01:00.000Z' });
    } finally {
      v8.close();
    }
  });

  it('creates every production store and operational index on a fresh install', async () => {
    const name = `tux-indexeddb-fresh-${crypto.randomUUID()}`;
    const database = await openAtVersion(name, INDEXED_DB_VERSION);
    try {
      expect([...database.objectStoreNames]).toEqual(
        expect.arrayContaining([...INDEXED_DB_STORES]),
      );
      expect([...database.objectStoreNames]).toContain('workerUiPreferences');
      expect([...database.objectStoreNames]).toContain('workerMenuLayouts');
      expect([...database.objectStoreNames]).toContain('orderLifecycleSyncCursor');
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

  it('upgrades a populated v1 database to the latest version without destroying business data', async () => {
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

    const latest = await openAtVersion(name, INDEXED_DB_VERSION);
    try {
      expect(latest.version).toBe(INDEXED_DB_VERSION);
      expect([...latest.objectStoreNames]).toContain('workerUiPreferences');
      expect([...latest.objectStoreNames]).toContain('workerMenuLayouts');
      const read = latest.transaction(
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
      latest.close();
    }
  });

  it('backfills legacy flat worker product order into per-category Menu Layout order', async () => {
    const name = `tux-indexeddb-menu-layout-backfill-${crypto.randomUUID()}`;
    const v3 = await openAtVersion(name, 3);
    const write = v3.transaction(['configurationSnapshots', 'workerUiPreferences'], 'readwrite');
    write.objectStore('configurationSnapshots').put({
      shopId: preferenceShopId,
      version: 1,
      updatedAt: '2026-08-25T01:00:00.000Z',
      categories: [
        { id: preferenceCategoryAId, shopId: preferenceShopId, active: true, sortOrder: 0 },
        { id: preferenceCategoryBId, shopId: preferenceShopId, active: true, sortOrder: 1 },
      ],
      products: [
        {
          id: preferenceProductAId,
          shopId: preferenceShopId,
          categoryId: preferenceCategoryAId,
          active: true,
          sortOrder: 0,
        },
        {
          id: preferenceProductBId,
          shopId: preferenceShopId,
          categoryId: preferenceCategoryBId,
          active: true,
          sortOrder: 0,
        },
        {
          id: preferenceProductCId,
          shopId: preferenceShopId,
          categoryId: preferenceCategoryAId,
          active: true,
          sortOrder: 1,
        },
      ],
    });
    write.objectStore('workerUiPreferences').put({
      id: `${preferenceShopId}:${preferenceWorkerAId}`,
      shopId: preferenceShopId,
      workerId: preferenceWorkerAId,
      categoryOrder: [preferenceCategoryBId, preferenceCategoryAId],
      categoryAlignment: 'right',
      productOrder: [
        preferenceProductCId,
        preferenceProductBId,
        preferenceProductAId,
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ],
      accentColor: customAccent,
      updatedAt: '2026-08-25T02:00:00.000Z',
      serverVersion: 7,
      syncState: 'CLEAN',
    });
    await transactionDone(write);
    v3.close();

    const latest = await openAtVersion(name, INDEXED_DB_VERSION);
    try {
      const read = latest.transaction(['workerMenuLayouts', 'workerUiPreferences'], 'readonly');
      await expect(
        requestResult(
          read.objectStore('workerMenuLayouts').get(`${preferenceShopId}:${preferenceWorkerAId}`),
        ),
      ).resolves.toMatchObject({
        shopId: preferenceShopId,
        workerId: preferenceWorkerAId,
        categoryOrder: [preferenceCategoryBId, preferenceCategoryAId],
        categoryAlignment: 'right',
        productOrderByCategory: {
          [preferenceCategoryAId]: [preferenceProductCId, preferenceProductAId],
          [preferenceCategoryBId]: [preferenceProductBId],
        },
        layoutVersion: 7,
        syncState: 'CLEAN',
      });
      await expect(
        requestResult(
          read.objectStore('workerUiPreferences').get(`${preferenceShopId}:${preferenceWorkerAId}`),
        ),
      ).resolves.toMatchObject({ accentColor: customAccent });
    } finally {
      latest.close();
    }
  });

  it('round-trips, upserts, isolates, and deletes worker UI preferences', async () => {
    const name = `tux-indexeddb-preferences-${crypto.randomUUID()}`;
    createdDatabases.add(name);
    const database = new IndexedDbOperationsDatabase(name);
    await database.initialize();
    try {
      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerAId),
        ),
      ).resolves.toBeNull();

      await database.transaction((transaction) =>
        transaction.workerUiPreferences.put(preference(preferenceWorkerAId)),
      );
      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerAId),
        ),
      ).resolves.toEqual(preference(preferenceWorkerAId));

      const updated = {
        ...preference(preferenceWorkerAId, 2),
        categoryOrder: [preferenceCategoryAId],
        categoryAlignment: 'left' as const,
        productOrder: [preferenceProductAId, preferenceProductBId],
        accentColor: customAccent,
        syncState: 'CLEAN' as const,
      };
      await database.transaction((transaction) => transaction.workerUiPreferences.put(updated));
      await database.transaction((transaction) =>
        transaction.workerUiPreferences.put(preference(preferenceWorkerBId, 1)),
      );

      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerAId),
        ),
      ).resolves.toEqual(updated);
      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerBId),
        ),
      ).resolves.toEqual(preference(preferenceWorkerBId, 1));

      await database.transaction((transaction) =>
        transaction.workerUiPreferences.delete(preferenceShopId, preferenceWorkerAId),
      );
      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerAId),
        ),
      ).resolves.toBeNull();
      await expect(
        database.transaction((transaction) =>
          transaction.workerUiPreferences.get(preferenceShopId, preferenceWorkerBId),
        ),
      ).resolves.toEqual(preference(preferenceWorkerBId, 1));
    } finally {
      await database.close();
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
    ).toThrow(`IndexedDB migration v${INDEXED_DB_VERSION + 1} is missing`);
  });
});
