export const INDEXED_DB_VERSION = 4;

export const INDEXED_DB_STORES = [
  'shops',
  'devices',
  'workers',
  'workerSessions',
  'workerUiPreferences',
  'workerMenuLayouts',
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

function legacyWorkerMenuLayout(
  preference: Record<string, unknown>,
  configuration: Record<string, unknown> | null,
): Record<string, unknown> {
  const shopId = typeof preference['shopId'] === 'string' ? preference['shopId'] : '';
  const workerId = typeof preference['workerId'] === 'string' ? preference['workerId'] : '';
  const rawCategories = Array.isArray(configuration?.['categories'])
    ? configuration['categories']
    : [];
  const rawProducts = Array.isArray(configuration?.['products']) ? configuration['products'] : [];
  const validCategories = new Set<string>();
  for (const value of rawCategories) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const category = value as Record<string, unknown>;
    if (
      category['shopId'] === shopId &&
      category['active'] === true &&
      typeof category['id'] === 'string'
    ) {
      validCategories.add(category['id']);
    }
  }

  const productCategory = new Map<string, string>();
  for (const value of rawProducts) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const product = value as Record<string, unknown>;
    if (
      product['shopId'] === shopId &&
      product['active'] === true &&
      typeof product['id'] === 'string' &&
      typeof product['categoryId'] === 'string' &&
      validCategories.has(product['categoryId'])
    ) {
      productCategory.set(product['id'], product['categoryId']);
    }
  }

  const categoryOrder = (
    Array.isArray(preference['categoryOrder']) ? preference['categoryOrder'] : []
  )
    .filter((value): value is string => typeof value === 'string')
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((value) => validCategories.size === 0 || validCategories.has(value));

  const productOrderByCategory: Record<string, string[]> = {};
  for (const productId of Array.isArray(preference['productOrder'])
    ? preference['productOrder']
    : []) {
    if (typeof productId !== 'string') continue;
    const categoryId = productCategory.get(productId);
    if (categoryId === undefined) continue;
    (productOrderByCategory[categoryId] ??= []).push(productId);
  }

  const serverVersion = preference['serverVersion'];
  return {
    id: `${shopId}:${workerId}`,
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment:
      preference['categoryAlignment'] === 'center' || preference['categoryAlignment'] === 'right'
        ? preference['categoryAlignment']
        : 'left',
    productOrderByCategory,
    layoutVersion:
      typeof serverVersion === 'number' && Number.isSafeInteger(serverVersion) && serverVersion >= 0
        ? serverVersion
        : 0,
    updatedAt:
      typeof preference['updatedAt'] === 'string'
        ? preference['updatedAt']
        : new Date(0).toISOString(),
    syncState: preference['syncState'] === 'DIRTY' ? 'DIRTY' : 'CLEAN',
  };
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
  {
    version: 3,
    name: 'worker_ui_preferences',
    apply(database) {
      database.createObjectStore('workerUiPreferences', { keyPath: 'id' });
    },
  },
  {
    version: 4,
    name: 'worker_menu_layouts',
    apply(database, transaction) {
      const layouts = database.createObjectStore('workerMenuLayouts', { keyPath: 'id' });
      const preferences = transaction.objectStore('workerUiPreferences');
      const configurations = transaction.objectStore('configurationSnapshots');
      const cursorRequest = preferences.openCursor();
      cursorRequest.addEventListener('success', () => {
        const cursor = cursorRequest.result;
        if (cursor === null) return;
        if (
          typeof cursor.value !== 'object' ||
          cursor.value === null ||
          Array.isArray(cursor.value)
        ) {
          cursor.continue();
          return;
        }
        const preference = cursor.value as Record<string, unknown>;
        const shopId = preference['shopId'];
        if (typeof shopId !== 'string') {
          cursor.continue();
          return;
        }
        const configurationRequest = configurations.get(shopId);
        configurationRequest.addEventListener(
          'success',
          () => {
            const configuration =
              typeof configurationRequest.result === 'object' &&
              configurationRequest.result !== null &&
              !Array.isArray(configurationRequest.result)
                ? (configurationRequest.result as Record<string, unknown>)
                : null;
            layouts.put(legacyWorkerMenuLayout(preference, configuration));
          },
          { once: true },
        );
        cursor.continue();
      });
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
