import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type InventoryItemId,
  type MenuCategoryId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { SqliteOperationsDatabase } from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import {
  OperationsConfigurationSyncService,
  type InboundConfigurationProvider,
} from './configurationSync';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const otherShopId = parseEntityId<ShopId>('22222222-2222-4222-8222-222222222222');
const categoryId = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333333');
const productId = parseEntityId<ProductId>('44444444-4444-4444-8444-444444444444');
const orderTypeId = parseEntityId<OrderTypeId>('55555555-5555-4555-8555-555555555555');
const paymentId = parseEntityId<PaymentMethodId>('66666666-6666-4666-8666-666666666666');
const inventoryOne = parseEntityId<InventoryItemId>('77777777-7777-4777-8777-777777777777');
const inventoryTwo = parseEntityId<InventoryItemId>('88888888-8888-4888-8888-888888888888');
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function bundle(version: number, options: { readonly secondInventoryOnly?: boolean } = {}) {
  const inventoryItems = options.secondInventoryOnly
    ? [
        {
          id: inventoryTwo,
          shopId,
          name: 'Packaging',
          unitLabel: 'piece',
          trackingMode: 'BULK_MANUAL' as const,
          active: true,
        },
      ]
    : [
        {
          id: inventoryOne,
          shopId,
          name: 'Patty',
          unitLabel: 'portion',
          trackingMode: 'RECIPE_TRACKED' as const,
          active: true,
        },
      ];
  return {
    snapshot: {
      shopId,
      version,
      updatedAt: instant(`2026-08-${String(18 + version).padStart(2, '0')}T00:00:00.000Z`),
      categories: [{ id: categoryId, shopId, name: 'Burgers', sortOrder: 1, active: true }],
      products: [
        {
          id: productId,
          shopId,
          categoryId,
          name: `Burger v${version}`,
          description: null,
          priceMinor: moneyMinor(10_000 + version),
          imageKey: null,
          active: true,
          soldOut: false,
          isCombo: false,
          sortOrder: 1,
        },
      ],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: options.secondInventoryOnly
        ? []
        : [
            {
              shopId,
              productId,
              inventoryItemId: inventoryOne,
              quantityMicros: stockQuantityMicros(1_000_000),
            },
          ],
      orderTypes: [
        {
          id: orderTypeId,
          shopId,
          name: 'Takeaway',
          behavior: 'TAKE_AWAY' as const,
          active: true,
          sortOrder: 1,
        },
      ],
      paymentMethods: [
        {
          id: paymentId,
          shopId,
          displayName: 'Cash',
          logicType: 'CASH' as const,
          requiresReconciliation: true,
          active: true,
          sortOrder: 1,
        },
      ],
      deliveryZones: [],
    },
    inventoryItems,
  };
}

function provider(version: number, payload: unknown): InboundConfigurationProvider {
  return {
    async discoverVersion() {
      return version;
    },
    async fetchCompleteConfiguration() {
      return payload;
    },
  };
}

async function databaseFixture(): Promise<SqliteOperationsDatabase> {
  const directory = await mkdtemp(join(tmpdir(), 'tux-config-sync-'));
  tempDirectories.push(directory);
  const database = new SqliteOperationsDatabase(join(directory, 'operations.sqlite'));
  await database.initialize();
  await database.transaction((transaction) =>
    transaction.shops.put({ id: shopId, name: 'Config Test Shop', active: true }),
  );
  return database;
}

describe('OperationsConfigurationSyncService', () => {
  it('uses the same validated atomic path for initial provisioning and newer remote versions', async () => {
    const database = await databaseFixture();
    const coordinator = new ApplicationCommandCoordinator();
    const service = new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(2, bundle(2)),
    );

    await expect(service.installProvisionedConfiguration(shopId, bundle(1))).resolves.toEqual({
      status: 'APPLIED',
      version: 1,
    });
    await expect(
      new OperationsConfigurationSyncService(
        database,
        coordinator,
        provider(2, bundle(2, { secondInventoryOnly: true })),
      ).sync(shopId),
    ).resolves.toEqual({ status: 'APPLIED', version: 2 });

    const state = await database.transaction(async (transaction) => ({
      snapshot: await transaction.configuration.getForShop(shopId),
      inventory: await transaction.inventory.listItemsForShop(shopId),
    }));
    expect(state.snapshot?.version).toBe(2);
    expect(state.snapshot?.products[0]?.name).toBe('Burger v2');
    expect(state.inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: inventoryOne, active: false }),
        expect.objectContaining({ id: inventoryTwo, active: true }),
      ]),
    );
    await database.close();
  });

  it('never downgrades and leaves the last known-good snapshot untouched when remote is invalid or unavailable', async () => {
    const database = await databaseFixture();
    const coordinator = new ApplicationCommandCoordinator();
    const seed = new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(3, bundle(3)),
    );
    await seed.installProvisionedConfiguration(shopId, bundle(3));

    const stale = new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(2, bundle(2)),
    );
    await expect(stale.sync(shopId)).resolves.toEqual({ status: 'UP_TO_DATE', version: 3 });

    const malformed = bundle(4);
    const invalid = {
      ...malformed,
      snapshot: {
        ...malformed.snapshot,
        products: [
          {
            ...malformed.snapshot.products[0]!,
            categoryId: '99999999-9999-4999-8999-999999999999',
          },
        ],
      },
    };
    const invalidResult = await new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(4, invalid),
    ).sync(shopId);
    expect(invalidResult.status).toBe('INVALID_REMOTE_CONFIGURATION');

    const unavailableProvider: InboundConfigurationProvider = {
      async discoverVersion() {
        throw new Error('offline');
      },
      async fetchCompleteConfiguration() {
        throw new Error('unreachable');
      },
    };
    await expect(
      new OperationsConfigurationSyncService(database, coordinator, unavailableProvider).sync(
        shopId,
      ),
    ).resolves.toEqual({ status: 'REMOTE_UNAVAILABLE', localVersion: 3 });

    const persisted = await database.transaction((transaction) =>
      transaction.configuration.getForShop(shopId),
    );
    expect(persisted?.version).toBe(3);
    expect(persisted?.products[0]?.name).toBe('Burger v3');
    await database.close();
  });

  it('rejects a cross-shop payload and rolls back the snapshot if inventory replacement fails', async () => {
    const database = await databaseFixture();
    const coordinator = new ApplicationCommandCoordinator();
    const seed = new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(1, bundle(1)),
    );
    await seed.installProvisionedConfiguration(shopId, bundle(1));

    const crossShop = {
      ...bundle(2),
      snapshot: { ...bundle(2).snapshot, shopId: otherShopId },
    };
    const crossShopResult = await new OperationsConfigurationSyncService(
      database,
      coordinator,
      provider(2, crossShop),
    ).sync(shopId);
    expect(crossShopResult.status).toBe('INVALID_REMOTE_CONFIGURATION');

    const failingDatabase: OperationsDatabase = {
      transaction: (work) =>
        database.transaction((transaction) =>
          work({
            ...transaction,
            inventory: {
              ...transaction.inventory,
              async replaceConfigurationItems() {
                throw new Error('injected inventory persistence failure');
              },
            },
          }),
        ),
    };
    const failed = await new OperationsConfigurationSyncService(
      failingDatabase,
      coordinator,
      provider(2, bundle(2)),
    ).sync(shopId);
    expect(failed.status).toBe('LOCAL_PERSISTENCE_ERROR');

    const persisted = await database.transaction(async (transaction) => ({
      snapshot: await transaction.configuration.getForShop(shopId),
      inventory: await transaction.inventory.listItemsForShop(shopId),
    }));
    expect(persisted.snapshot?.version).toBe(1);
    expect(persisted.inventory).toEqual([
      expect.objectContaining({ id: inventoryOne, active: true }),
    ]);
    await database.close();
  });
});
