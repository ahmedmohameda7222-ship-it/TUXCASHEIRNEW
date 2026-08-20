import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from 'node:process';
import {
  ApplicationCommandCoordinator,
  OperationsConfigurationSyncService,
  type InboundConfigurationProvider,
} from '@tux/application';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type InventoryItem,
  type InventoryItemId,
  type MenuCategoryId,
  type ModifierId,
  type OperationsConfigurationBundle,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';

const DEV_SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const DEV_WORKER_ONE_ID = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const DEV_WORKER_TWO_ID = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');
const PBKDF2_ITERATIONS = 210_000;
const DERIVED_KEY_BYTES = 32;

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  return value === undefined || value.length === 0 ? null : value;
}

function developmentDatabasePath(): string {
  return resolve(argument('--database') ?? '.tux-dev/operations.sqlite3');
}

function hashDevelopmentPin(pin: string): string {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('Development PIN must contain 4 to 8 digits.');
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(pin, salt, PBKDF2_ITERATIONS, DERIVED_KEY_BYTES, 'sha256');
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

function entityId<Id>(prefix: string, index: number, parse: (value: string) => Id): Id {
  return parse(`${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`);
}

function configurationBundle(updatedAt: ReturnType<typeof instant>): OperationsConfigurationBundle {
  const category = (index: number) =>
    entityId<MenuCategoryId>('30000000', index, (value) => parseEntityId<MenuCategoryId>(value));
  const product = (index: number) =>
    entityId<ProductId>('40000000', index, (value) => parseEntityId<ProductId>(value));
  const modifier = (index: number) =>
    entityId<ModifierId>('50000000', index, (value) => parseEntityId<ModifierId>(value));
  const inventory = (index: number) =>
    entityId<InventoryItemId>('60000000', index, (value) => parseEntityId<InventoryItemId>(value));
  const orderType = (index: number) =>
    entityId<OrderTypeId>('70000000', index, (value) => parseEntityId<OrderTypeId>(value));
  const payment = (index: number) =>
    entityId<PaymentMethodId>('80000000', index, (value) => parseEntityId<PaymentMethodId>(value));

  const categories = [
    { id: category(1), shopId: DEV_SHOP_ID, name: 'Burgers', sortOrder: 0, active: true },
    { id: category(2), shopId: DEV_SHOP_ID, name: 'Sides', sortOrder: 1, active: true },
    { id: category(3), shopId: DEV_SHOP_ID, name: 'Drinks', sortOrder: 2, active: true },
  ];
  const products = [
    ['Classic Smash', 12_000, 1, false, false],
    ['Double Smash', 16_000, 1, false, false],
    ['Triple Smash', 20_000, 1, false, false],
    ['TUX Loaded Burger', 22_000, 1, false, false],
    ['Crispy Chicken', 14_000, 1, false, false],
    ['Spicy Chicken', 15_000, 1, false, false],
    ['Combo Smash + Required Beverage', 19_000, 1, true, false],
    ['Long Name Layout Stress Burger with Extra Description', 21_000, 1, false, false],
    ['Sold Out Test Burger', 17_000, 1, false, true],
    ['Fries', 5_000, 2, false, false],
    ['Loaded Fries', 8_000, 2, false, false],
    ['Onion Rings', 6_000, 2, false, false],
    ['Cola', 3_000, 3, false, false],
    ['Diet Cola', 3_000, 3, false, false],
    ['Water', 2_000, 3, false, false],
    ['Orange Soda', 3_000, 3, false, false],
    ['Lemon Soda', 3_000, 3, false, false],
    ['Iced Tea', 4_000, 3, false, false],
  ].map(([name, price, categoryIndex, isCombo, soldOut], index) => ({
    id: product(index + 1),
    shopId: DEV_SHOP_ID,
    categoryId: category(categoryIndex as number),
    name: name as string,
    description:
      index === 7 ? 'Development-only long text used to stress responsive menu layout.' : null,
    priceMinor: moneyMinor(price as number),
    imageKey: null,
    active: true,
    soldOut: soldOut as boolean,
    isCombo: isCombo as boolean,
    sortOrder: index,
  }));
  const modifiers = [
    {
      id: modifier(1),
      shopId: DEV_SHOP_ID,
      name: 'Extra Cheese',
      priceMinor: moneyMinor(2_000),
      standaloneProductId: null,
      active: true,
      sortOrder: 0,
    },
    {
      id: modifier(2),
      shopId: DEV_SHOP_ID,
      name: 'Extra Patty',
      priceMinor: moneyMinor(4_000),
      standaloneProductId: null,
      active: true,
      sortOrder: 1,
    },
    {
      id: modifier(3),
      shopId: DEV_SHOP_ID,
      name: 'No Onion',
      priceMinor: moneyMinor(0),
      standaloneProductId: null,
      active: true,
      sortOrder: 2,
    },
  ];
  const inventoryItems: readonly InventoryItem[] = [
    {
      id: inventory(1),
      shopId: DEV_SHOP_ID,
      name: 'Beef Patty',
      unitLabel: 'portion',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    },
    {
      id: inventory(2),
      shopId: DEV_SHOP_ID,
      name: 'Chicken Fillet',
      unitLabel: 'portion',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    },
    {
      id: inventory(3),
      shopId: DEV_SHOP_ID,
      name: 'Burger Bun',
      unitLabel: 'piece',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    },
    {
      id: inventory(4),
      shopId: DEV_SHOP_ID,
      name: 'Fries Bulk Bag',
      unitLabel: 'bag',
      trackingMode: 'BULK_MANUAL',
      active: true,
    },
    {
      id: inventory(5),
      shopId: DEV_SHOP_ID,
      name: 'Packaging Box',
      unitLabel: 'box',
      trackingMode: 'BULK_MANUAL',
      active: true,
    },
  ];

  return {
    snapshot: {
      shopId: DEV_SHOP_ID,
      version: 1,
      updatedAt,
      categories,
      products,
      modifiers,
      productModifierLinks: [
        {
          shopId: DEV_SHOP_ID,
          productId: product(1),
          modifierId: modifier(1),
          maxQuantity: 2,
          sortOrder: 0,
        },
        {
          shopId: DEV_SHOP_ID,
          productId: product(1),
          modifierId: modifier(2),
          maxQuantity: 3,
          sortOrder: 1,
        },
        {
          shopId: DEV_SHOP_ID,
          productId: product(1),
          modifierId: modifier(3),
          maxQuantity: 1,
          sortOrder: 2,
        },
      ],
      comboBeverageOptions: [13, 14, 15, 16, 17, 18].map((beverageIndex, sortOrder) => ({
        shopId: DEV_SHOP_ID,
        comboProductId: product(7),
        beverageProductId: product(beverageIndex),
        sortOrder,
      })),
      recipeLines: [
        {
          shopId: DEV_SHOP_ID,
          productId: product(1),
          inventoryItemId: inventory(1),
          quantityMicros: stockQuantityMicros(1_000_000),
        },
        {
          shopId: DEV_SHOP_ID,
          productId: product(1),
          inventoryItemId: inventory(3),
          quantityMicros: stockQuantityMicros(1_000_000),
        },
        {
          shopId: DEV_SHOP_ID,
          productId: product(5),
          inventoryItemId: inventory(2),
          quantityMicros: stockQuantityMicros(1_000_000),
        },
        {
          shopId: DEV_SHOP_ID,
          productId: product(5),
          inventoryItemId: inventory(3),
          quantityMicros: stockQuantityMicros(1_000_000),
        },
      ],
      orderTypes: [
        {
          id: orderType(1),
          shopId: DEV_SHOP_ID,
          name: 'Take Away',
          behavior: 'TAKE_AWAY',
          sortOrder: 0,
          active: true,
        },
        {
          id: orderType(2),
          shopId: DEV_SHOP_ID,
          name: 'Dine In',
          behavior: 'DINE_IN',
          sortOrder: 1,
          active: true,
        },
        {
          id: orderType(3),
          shopId: DEV_SHOP_ID,
          name: 'Delivery',
          behavior: 'DELIVERY',
          sortOrder: 2,
          active: true,
        },
      ],
      paymentMethods: [
        {
          id: payment(1),
          shopId: DEV_SHOP_ID,
          displayName: 'Cash',
          logicType: 'CASH',
          requiresReconciliation: true,
          sortOrder: 0,
          active: true,
        },
        {
          id: payment(2),
          shopId: DEV_SHOP_ID,
          displayName: 'Instapay',
          logicType: 'DIGITAL',
          requiresReconciliation: true,
          sortOrder: 1,
          active: true,
        },
      ],
      deliveryZones: [
        {
          id: parseEntityId('90000000-0000-4000-8000-000000000001'),
          shopId: DEV_SHOP_ID,
          name: 'Downtown Demo',
          feeMinor: moneyMinor(3_500),
          sortOrder: 0,
          active: true,
        },
        {
          id: parseEntityId('90000000-0000-4000-8000-000000000002'),
          shopId: DEV_SHOP_ID,
          name: 'Outer Demo Zone',
          feeMinor: moneyMinor(5_000),
          sortOrder: 1,
          active: true,
        },
      ],
    },
    inventoryItems,
  };
}

const unusedRemoteProvider: InboundConfigurationProvider = {
  async discoverVersion() {
    throw new Error('Development provisioning does not use a remote provider.');
  },
  async fetchCompleteConfiguration() {
    throw new Error('Development provisioning does not use a remote provider.');
  },
};

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Development provisioning is disabled when NODE_ENV=production.');
  }
  if (!process.argv.includes('--development')) {
    throw new Error('Development provisioning requires the explicit --development safety flag.');
  }

  const databasePath = developmentDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  const primaryPin = argument('--pin') ?? '1234';
  const secondaryPin = argument('--secondary-pin') ?? '5678';
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

    await database.transaction(async (transaction) => {
      const existingShop = await transaction.shops.getById(DEV_SHOP_ID);
      if (existingShop !== null && existingShop.name !== 'TUX Development Shop') {
        throw new Error(
          'Refusing to overwrite a non-development record using the reserved dev Shop ID.',
        );
      }
      await transaction.shops.put({ id: DEV_SHOP_ID, name: 'TUX Development Shop', active: true });
      await transaction.workers.put({
        id: DEV_WORKER_ONE_ID,
        shopId: DEV_SHOP_ID,
        displayName: 'Demo Worker One',
        pinHash: hashDevelopmentPin(primaryPin),
        active: true,
      });
      await transaction.workers.put({
        id: DEV_WORKER_TWO_ID,
        shopId: DEV_SHOP_ID,
        displayName: 'Demo Worker Two',
        pinHash: hashDevelopmentPin(secondaryPin),
        active: true,
      });
    });

    const service = new OperationsConfigurationSyncService(
      database,
      new ApplicationCommandCoordinator(),
      unusedRemoteProvider,
    );
    const result = await service.installProvisionedConfiguration(
      DEV_SHOP_ID,
      configurationBundle(instant(new Date())),
    );
    if (result.status !== 'APPLIED' && result.status !== 'UP_TO_DATE') {
      throw new Error(`Configuration provisioning failed: ${result.status}`);
    }

    process.stdout.write(
      `Provisioned development-only TUX shop at ${databasePath}. Demo worker PINs were hashed before storage.\n`,
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
