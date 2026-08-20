export const INDEXED_DB_VERSION = 2;

export const INDEXED_DB_STORES = [
  'shops',
  'devices',
  'workers',
  'workerSessions',
  'configurationSnapshots',
  'customerContacts',
  'businessDays',
  'orders',
  'expenses',
  'inventoryItems',
  'inventoryMovements',
  'reconciliations',
  'auditEvents',
  'outboxEvents',
] as const;

export type IndexedDbStoreName = (typeof INDEXED_DB_STORES)[number];

interface IndexedDbMigration {
  readonly version: number;
  readonly name: string;
  apply(database: IDBDatabase, transaction: IDBTransaction): void;
}

const MIGRATIONS: readonly IndexedDbMigration[] = [
  {
    version: 1,
    name: 'initial_operations_schema',
    apply(database) {
      const shops = database.createObjectStore('shops', { keyPath: 'id' });
      shops.createIndex('active', 'active');

      const devices = database.createObjectStore('devices', { keyPath: 'id' });
      devices.createIndex('shopId', 'shopId');

      const workers = database.createObjectStore('workers', { keyPath: 'id' });
      workers.createIndex('shopId', 'shopId');

      database.createObjectStore('workerSessions', { keyPath: 'id' });
      database.createObjectStore('configurationSnapshots', { keyPath: 'shopId' });

      const customerContacts = database.createObjectStore('customerContacts', { keyPath: 'id' });
      customerContacts.createIndex('shopPhone', ['shopId', 'normalizedPhone'], { unique: true });

      const businessDays = database.createObjectStore('businessDays', { keyPath: 'id' });
      businessDays.createIndex('shopStatus', ['shopId', 'status']);

      const orders = database.createObjectStore('orders', { keyPath: 'id' });
      orders.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      orders.createIndex('businessDayStatus', ['businessDayId', 'status']);

      const expenses = database.createObjectStore('expenses', { keyPath: 'id' });
      expenses.createIndex('businessDayId', 'businessDayId');

      const inventoryItems = database.createObjectStore('inventoryItems', { keyPath: 'id' });
      inventoryItems.createIndex('shopTrackingMode', ['shopId', 'trackingMode']);

      const inventoryMovements = database.createObjectStore('inventoryMovements', {
        keyPath: 'id',
      });
      inventoryMovements.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], {
        unique: true,
      });

      const reconciliations = database.createObjectStore('reconciliations', { keyPath: 'id' });
      reconciliations.createIndex('shopBusinessDay', ['shopId', 'businessDayId'], { unique: true });

      database.createObjectStore('auditEvents', { keyPath: 'id' });

      const outbox = database.createObjectStore('outboxEvents', { keyPath: 'id' });
      outbox.createIndex('shopIdempotency', ['shopId', 'idempotencyKey'], { unique: true });
      outbox.createIndex('deliveredAt', 'deliveredAt');
    },
  },
  {
    version: 2,
    name: 'operational_query_and_outbox_dependency_indexes',
    apply(_database, transaction) {
      transaction.objectStore('workerSessions').createIndex('businessDayId', 'businessDayId');
      transaction
        .objectStore('orders')
        .createIndex('businessDayCreatedAt', ['businessDayId', 'createdAt']);
      transaction
        .objectStore('expenses')
        .createIndex('businessDayCreatedAt', ['businessDayId', 'createdAt']);
      transaction.objectStore('inventoryItems').createIndex('shopId', 'shopId');
      const movements = transaction.objectStore('inventoryMovements');
      movements.createIndex('orderCreatedAt', ['orderId', 'createdAt']);
      movements.createIndex('itemCreatedAt', ['itemId', 'createdAt']);
      movements.createIndex('compensatesMovementId', 'compensatesMovementId');
      const outbox = transaction.objectStore('outboxEvents');
      outbox.createIndex('createdAt', 'createdAt');
      outbox.createIndex('aggregateStream', [
        'shopId',
        'aggregateType',
        'aggregateId',
        'aggregateRevision',
      ]);
    },
  },
];

export function indexedDbMigrationVersions(): readonly number[] {
  return MIGRATIONS.map((migration) => migration.version);
}

export function applyIndexedDbMigrations(
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
  newVersion: number,
): void {
  if (!Number.isSafeInteger(oldVersion) || oldVersion < 0) {
    throw new RangeError('IndexedDB old version must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(newVersion) || newVersion < oldVersion) {
    throw new RangeError('IndexedDB new version must be a safe integer at least oldVersion.');
  }
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migration = MIGRATIONS.find((candidate) => candidate.version === version);
    if (migration === undefined) {
      throw new Error(`IndexedDB migration v${version} is missing; refusing to skip schema state.`);
    }
    migration.apply(database, transaction);
  }
}
