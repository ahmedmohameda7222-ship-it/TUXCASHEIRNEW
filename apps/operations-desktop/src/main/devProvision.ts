import { resolve } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type CategoryId,
  type DeliveryZoneId,
  type InventoryItemId,
  type OperationsConfigurationSnapshot,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
} from '@tux/persistence/sqlite';

const DEV_SHOP_ID = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000101');
const DEV_WORKER_ID = parseEntityId<WorkerId>('00000000-0000-4000-8000-000000000102');
const DEV_CATEGORY_ID = parseEntityId<CategoryId>('00000000-0000-4000-8000-000000000103');
const DEV_PRODUCT_ID = parseEntityId<ProductId>('00000000-0000-4000-8000-000000000104');
const DEV_ORDER_TYPE_ID = parseEntityId<OrderTypeId>('00000000-0000-4000-8000-000000000105');
const DEV_PAYMENT_METHOD_ID = parseEntityId<PaymentMethodId>('00000000-0000-4000-8000-000000000106');
const DEV_DELIVERY_ZONE_ID = parseEntityId<DeliveryZoneId>('00000000-0000-4000-8000-000000000107');
const DEV_INVENTORY_ITEM_ID = parseEntityId<InventoryItemId>('00000000-0000-4000-8000-000000000108');

function requiredArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required ${name} argument.`);
  }
  return value;
}

function configuration(updatedAt: ReturnType<typeof instant>): OperationsConfigurationSnapshot {
  return {
    shopId: DEV_SHOP_ID,
    version: 1,
    categories: [
      {
        id: DEV_CATEGORY_ID,
        shopId: DEV_SHOP_ID,
        name: 'Development',
        sortOrder: 1,
        active: true,
      },
    ],
    products: [
      {
        id: DEV_PRODUCT_ID,
        shopId: DEV_SHOP_ID,
        categoryId: DEV_CATEGORY_ID,
        name: 'Development Burger',
        priceMinor: moneyMinor(10000),
        active: true,
        sortOrder: 1,
        modifierGroupIds: [],
        allowsItemNote: true,
        combo: null,
      },
    ],
    modifierGroups: [],
    modifiers: [],
    orderTypes: [
      {
        id: DEV_ORDER_TYPE_ID,
        shopId: DEV_SHOP_ID,
        name: 'Delivery',
        behavior: 'DELIVERY',
        sortOrder: 1,
        active: true,
      },
    ],
    paymentMethods: [
      {
        id: DEV_PAYMENT_METHOD_ID,
        shopId: DEV_SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        sortOrder: 1,
        active: true,
      },
    ],
    deliveryZones: [
      {
        id: DEV_DELIVERY_ZONE_ID,
        shopId: DEV_SHOP_ID,
        label: 'Development Zone',
        feeMinor: moneyMinor(2500),
        active: true,
        sortOrder: 1,
      },
    ],
    inventoryItems: [
      {
        id: DEV_INVENTORY_ITEM_ID,
        shopId: DEV_SHOP_ID,
        name: 'Development Patty',
        unitLabel: 'patty',
        trackingMode: 'RECIPE_TRACKED',
        active: true,
      },
    ],
    recipeLines: [
      {
        productId: DEV_PRODUCT_ID,
        inventoryItemId: DEV_INVENTORY_ITEM_ID,
        quantityMicros: stockQuantityMicros(1_000_000),
      },
    ],
    updatedAt,
  };
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Development provisioning is disabled when NODE_ENV=production.');
  }

  const databasePath = resolve(requiredArgument('--database'));
  const pinHash = requiredArgument('--pin-hash');
  if (pinHash.length < 20) {
    throw new Error('--pin-hash must be a normal precomputed worker PIN hash, not a plaintext PIN.');
  }

  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  try {
    const activeShops = await readModel.listActiveShops();
    const nonDevelopmentShop = activeShops.find((shop) => shop.id !== DEV_SHOP_ID);
    if (nonDevelopmentShop !== undefined) {
      throw new Error(
        `Refusing to provision: active non-development shop ${nonDevelopmentShop.id} already exists.`,
      );
    }

    const now = instant(new Date());
    await database.transaction(async (transaction) => {
      const existingShop = await transaction.shops.getById(DEV_SHOP_ID);
      if (existingShop !== null && existingShop.name !== 'TUX Development Shop') {
        throw new Error('Refusing to overwrite an existing record that uses the reserved dev Shop ID.');
      }
      const existingWorker = await transaction.workers.getById(DEV_WORKER_ID);
      if (existingWorker !== null && existingWorker.displayName !== 'Development Worker') {
        throw new Error('Refusing to overwrite an existing record that uses the reserved dev Worker ID.');
      }

      await transaction.shops.put({
        id: DEV_SHOP_ID,
        name: 'TUX Development Shop',
        active: true,
      });
      await transaction.workers.put({
        id: DEV_WORKER_ID,
        shopId: DEV_SHOP_ID,
        displayName: 'Development Worker',
        pinHash,
        active: true,
      });
      const snapshot = configuration(now);
      await transaction.configuration.put(snapshot);
      for (const item of snapshot.inventoryItems) {
        await transaction.inventory.putItem(item);
      }
    });

    process.stdout.write(
      `Provisioned TUX Development Shop at ${databasePath}. Re-running this command is idempotent.\n`,
    );
  } finally {
    await readModel.close();
    await database.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Development provisioning failed: ${message}\n`);
  process.exitCode = 1;
});
