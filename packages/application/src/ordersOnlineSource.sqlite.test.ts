import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type DraftLineId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type OrderId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsOrdersService } from './orders';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const WORKER_ID = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const DAY_ID = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('44444444-4444-4444-8444-444444444444');
const PRODUCT_ID = parseEntityId<ProductId>('55555555-5555-4555-8555-555555555555');
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('66666666-6666-4666-8666-666666666666');
const PAYMENT_ID = parseEntityId<PaymentMethodId>('77777777-7777-4777-8777-777777777777');
const RESERVED_ORDER_ID = parseEntityId<OrderId>('88888888-8888-4888-8888-888888888888');
const AT = instant('2026-09-08T10:30:00.000Z');
const temporaryDirectories: string[] = [];

interface CheckoutFixtureSettings {
  readonly settingsVersion: number;
  readonly minimumOrderMinor: number;
  readonly serviceChargeBps: number;
  readonly taxBps: number;
}

function configuration(
  paymentChannel: 'POS' | 'ONLINE' | 'BOTH' = 'BOTH',
  checkout?: CheckoutFixtureSettings,
  configurationVersion = 1,
): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: configurationVersion,
    updatedAt: AT,
    categories: [{ id: CATEGORY_ID, shopId: SHOP_ID, name: 'Burgers', sortOrder: 0, active: true }],
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Online Burger',
        description: null,
        priceMinor: moneyMinor(19_000),
        imageKey: null,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 0,
      },
    ],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [
      {
        id: ORDER_TYPE_ID,
        shopId: SHOP_ID,
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 0,
      },
    ],
    paymentMethods: [
      {
        id: PAYMENT_ID,
        shopId: SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 0,
        channel: paymentChannel,
      },
    ],
    deliveryZones: [],
    ...(checkout === undefined
      ? {}
      : {
          settings: {
            version: checkout.settingsVersion,
            values: {
              'checkout.minimumOrderMinor': checkout.minimumOrderMinor,
              'checkout.serviceChargeBps': checkout.serviceChargeBps,
              'checkout.taxBps': checkout.taxBps,
            },
            shopIdentity: {
              shopId: SHOP_ID,
              displayName: 'TUX',
              address: null,
              phone: null,
              latitude: null,
              longitude: null,
              timezone: 'Africa/Cairo' as const,
              lifecycleState: 'ACTIVE' as const,
              temporaryClosed: false,
              onlineOrdersPaused: false,
            },
            weeklyHours: [],
            specialHours: [],
            paymentMethodZoneRules: [],
          },
        }),
  };
}

function draft(intentKey: string): OrderDraft {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    draftScopeId: 'orders-online-source-test',
    revision: 0,
    updatedAt: AT,
    checkoutIntentKey: intentKey,
    orderTypeId: ORDER_TYPE_ID,
    lines: [
      {
        id: parseEntityId<DraftLineId>('99999999-9999-4999-8999-999999999999'),
        productId: PRODUCT_ID,
        productName: 'Online Burger',
        unitPriceMinor: moneyMinor(19_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
        addedSequence: 1,
      },
    ],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: {
      mode: 'SINGLE',
      methodId: PAYMENT_ID,
      cashReceivedMinor: moneyMinor(30_000),
    },
  };
}

async function fixture(
  paymentChannel: 'POS' | 'ONLINE' | 'BOTH' = 'BOTH',
  checkout?: CheckoutFixtureSettings,
  configurationVersion = 1,
) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-order-source-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(path);
  await database.initialize();
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Worker',
      pinHash: 'test-only',
      active: true,
    });
    await transaction.businessDays.put({
      id: DAY_ID,
      shopId: SHOP_ID,
      status: 'OPEN',
      startedAt: AT,
      endedAt: null,
      startedByWorkerId: WORKER_ID,
      endedByWorkerId: null,
      lastAllocatedDisplayOrderNo: 0,
    });
    await transaction.workerSessions.put({
      id: parseEntityId<WorkerSessionId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      startedAt: AT,
      endedAt: null,
    });
    await transaction.configuration.put(
      configuration(paymentChannel, checkout, configurationVersion),
    );
  });

  const readModel = new SqliteOperatorSessionReadModel(path);
  const draftStore = new SqliteOrderDraftStore(path);
  await draftStore.initialize();
  let sequence = 0;
  const service = new OperationsOrdersService(
    database,
    readModel,
    draftStore,
    {
      now: () => AT,
      createUuid: () => `bbbbbbbb-bbbb-4bbb-8bbb-${String(++sequence).padStart(12, '0')}`,
    },
    new ApplicationCommandCoordinator(),
    { print: async () => ({ ok: true as const }) },
  );

  return { database, readModel, draftStore, service };
}

async function closeFixture(test: Awaited<ReturnType<typeof fixture>>) {
  await test.readModel.close();
  await test.draftStore.close();
  await test.database.close();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('OperationsOrdersService placement origin', () => {
  it('keeps normal checkout source POS by default', async () => {
    const test = await fixture();
    const result = await test.service.placeOrder(draft('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.source).toBe('POS');
    await closeFixture(test);
  });

  it('uses the worker-confirmed reserved remote identity only for explicit ONLINE placement', async () => {
    const test = await fixture();
    const result = await test.service.placeOrder(draft('dddddddd-dddd-4ddd-8ddd-dddddddddddd'), {
      source: 'ONLINE',
      orderId: RESERVED_ORDER_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.order.source).toBe('ONLINE');
    expect(result.value.order.id).toBe(RESERVED_ORDER_ID);

    const persisted = await test.database.transaction((transaction) =>
      transaction.orders.getById(RESERVED_ORDER_ID),
    );
    expect(persisted?.source).toBe('ONLINE');
    expect(persisted?.id).toBe(RESERVED_ORDER_ID);

    await closeFixture(test);
  });

  it('rejects an ONLINE-only payment method at the trusted POS placement boundary', async () => {
    const test = await fixture('ONLINE');
    const result = await test.service.placeOrder(draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/payment.*pos|pos.*payment/i);
    await closeFixture(test);
  });

  it('accepts an ONLINE-only payment method for explicit ONLINE placement', async () => {
    const test = await fixture('ONLINE');
    const result = await test.service.placeOrder(draft('ffffffff-ffff-4fff-8fff-ffffffffffff'), {
      source: 'ONLINE',
      orderId: RESERVED_ORDER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.order.source).toBe('ONLINE');
    await closeFixture(test);
  });

  it('rejects a POS order below the effective published minimum', async () => {
    const test = await fixture('BOTH', {
      settingsVersion: 4,
      minimumOrderMinor: 20_000,
      serviceChargeBps: 0,
      taxBps: 0,
    });
    const result = await test.service.placeOrder(draft('11111111-aaaa-4aaa-8aaa-111111111111'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/minimum order/i);
    await closeFixture(test);
  });

  it('applies published service charge and tax to the trusted total and immutable order snapshot', async () => {
    const test = await fixture(
      'BOTH',
      {
        settingsVersion: 7,
        minimumOrderMinor: 5_000,
        serviceChargeBps: 1_000,
        taxBps: 1_400,
      },
      12,
    );
    const result = await test.service.placeOrder(draft('22222222-aaaa-4aaa-8aaa-222222222222'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.order.itemsSubtotalMinor).toBe(19_000);
    expect(result.value.order.serviceChargeMinor).toBe(1_900);
    expect(result.value.order.taxMinor).toBe(2_926);
    expect(result.value.order.totalMinor).toBe(23_826);
    expect(result.value.order.checkoutSnapshot).toMatchObject({
      configurationVersion: 12,
      settingsVersion: 7,
      channel: 'POS',
      minimumOrderMinor: 5_000,
      serviceChargeBps: 1_000,
      serviceChargeMinor: 1_900,
      taxBps: 1_400,
      taxMinor: 2_926,
    });

    await closeFixture(test);
  });

  it('keeps an earlier checkout snapshot unchanged after a later settings publication', async () => {
    const test = await fixture(
      'BOTH',
      {
        settingsVersion: 1,
        minimumOrderMinor: 0,
        serviceChargeBps: 1_000,
        taxBps: 0,
      },
      1,
    );
    const first = await test.service.placeOrder(draft('33333333-aaaa-4aaa-8aaa-333333333333'));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.order.totalMinor).toBe(20_900);

    await test.database.transaction((transaction) =>
      transaction.configuration.put(
        configuration(
          'BOTH',
          {
            settingsVersion: 2,
            minimumOrderMinor: 0,
            serviceChargeBps: 2_000,
            taxBps: 0,
          },
          2,
        ),
      ),
    );

    const second = await test.service.placeOrder(draft('44444444-aaaa-4aaa-8aaa-444444444444'));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.order.totalMinor).toBe(22_800);
    expect(first.value.order.totalMinor).toBe(20_900);
    expect(first.value.order.checkoutSnapshot).toMatchObject({
      configurationVersion: 1,
      settingsVersion: 1,
      serviceChargeMinor: 1_900,
    });
    expect(second.value.order.checkoutSnapshot).toMatchObject({
      configurationVersion: 2,
      settingsVersion: 2,
      serviceChargeMinor: 3_800,
    });

    await closeFixture(test);
  });
});
