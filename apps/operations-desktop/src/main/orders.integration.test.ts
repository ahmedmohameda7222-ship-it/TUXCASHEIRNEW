import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationsOrdersService } from '@tux/application';
import {
  createOpenBusinessDay,
  instant,
  moneyMinor,
  parseEntityId,
  stockQuantityMicros,
  type BusinessDayId,
  type DeliveryZoneId,
  type DraftLineId,
  type InventoryItemId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const SESSION_ID = parseEntityId<WorkerSessionId>('30000000-0000-4000-8000-000000000001');
const BUSINESS_DAY_ID = parseEntityId<BusinessDayId>('40000000-0000-4000-8000-000000000001');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('50000000-0000-4000-8000-000000000001');
const PRODUCT_ID = parseEntityId<ProductId>('60000000-0000-4000-8000-000000000001');
const INVENTORY_ITEM_ID = parseEntityId<InventoryItemId>('70000000-0000-4000-8000-000000000001');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('80000000-0000-4000-8000-000000000001');
const DELIVERY_ID = parseEntityId<OrderTypeId>('80000000-0000-4000-8000-000000000002');
const CASH_ID = parseEntityId<PaymentMethodId>('90000000-0000-4000-8000-000000000001');
const DIGITAL_ID = parseEntityId<PaymentMethodId>('90000000-0000-4000-8000-000000000002');
const ZONE_ID = parseEntityId<DeliveryZoneId>('a0000000-0000-4000-8000-000000000001');
const DRAFT_LINE_ID = parseEntityId<DraftLineId>('b0000000-0000-4000-8000-000000000001');

const DRAFT_SCOPE = 'desktop-main-window';
const STARTED_AT = instant('2026-08-18T13:00:00.000Z');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close();
  }
});

function configuration(): OperationsConfigurationSnapshot {
  return {
    shopId: SHOP_ID,
    version: 1,
    updatedAt: STARTED_AT,
    categories: [
      {
        id: CATEGORY_ID,
        shopId: SHOP_ID,
        name: 'Burgers',
        sortOrder: 0,
        active: true,
      },
    ],
    products: [
      {
        id: PRODUCT_ID,
        shopId: SHOP_ID,
        categoryId: CATEGORY_ID,
        name: 'Double Smash',
        description: 'Two smashed patties.',
        priceMinor: moneyMinor(16_000),
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
    recipeLines: [
      {
        shopId: SHOP_ID,
        productId: PRODUCT_ID,
        inventoryItemId: INVENTORY_ITEM_ID,
        quantityMicros: stockQuantityMicros(500_000),
      },
    ],
    orderTypes: [
      {
        id: TAKE_AWAY_ID,
        shopId: SHOP_ID,
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 0,
      },
      {
        id: DELIVERY_ID,
        shopId: SHOP_ID,
        name: 'Delivery',
        behavior: 'DELIVERY',
        active: true,
        sortOrder: 1,
      },
    ],
    paymentMethods: [
      {
        id: CASH_ID,
        shopId: SHOP_ID,
        displayName: 'Cash',
        logicType: 'CASH',
        requiresReconciliation: true,
        active: true,
        sortOrder: 0,
      },
      {
        id: DIGITAL_ID,
        shopId: SHOP_ID,
        displayName: 'Instapay',
        logicType: 'DIGITAL',
        requiresReconciliation: true,
        active: true,
        sortOrder: 1,
      },
    ],
    deliveryZones: [
      {
        id: ZONE_ID,
        shopId: SHOP_ID,
        name: 'Zone A',
        feeMinor: moneyMinor(3_000),
        active: true,
        sortOrder: 0,
      },
    ],
  };
}

async function fixture(databaseOverride?: (base: SqliteOperationsDatabase) => OperationsDatabase) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-orders-'));
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'fixture-only',
      active: true,
    });
    await transaction.businessDays.put(
      createOpenBusinessDay({
        id: BUSINESS_DAY_ID,
        shopId: SHOP_ID,
        startedAt: STARTED_AT,
        startedByWorkerId: WORKER_ID,
      }),
    );
    await transaction.workerSessions.put({
      id: SESSION_ID,
      shopId: SHOP_ID,
      businessDayId: BUSINESS_DAY_ID,
      workerId: WORKER_ID,
      startedAt: STARTED_AT,
      endedAt: null,
    });
    await transaction.configuration.put(configuration());
    await transaction.inventory.putItem({
      id: INVENTORY_ITEM_ID,
      shopId: SHOP_ID,
      name: 'Beef',
      unitLabel: 'g',
      trackingMode: 'RECIPE_TRACKED',
      active: true,
    });
  });

  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  const draftStore = new SqliteOrderDraftStore(databasePath);
  await draftStore.initialize();
  const serviceDatabase = databaseOverride?.(database) ?? database;
  let now = instant('2026-08-18T14:00:00.000Z');
  const service = new OperationsOrdersService(serviceDatabase, readModel, draftStore, {
    now: () => now,
    createUuid: () => randomUUID(),
  });

  cleanup.push(async () => {
    await readModel.close();
    await draftStore.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    databasePath,
    database,
    draftStore,
    service,
    setNow(value: string) {
      now = instant(value);
    },
  };
}

function withSingleBurger(draft: OrderDraft): OrderDraft {
  return {
    ...draft,
    lines: [
      {
        id: DRAFT_LINE_ID,
        productId: PRODUCT_ID,
        productName: 'Double Smash',
        unitPriceMinor: moneyMinor(16_000),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
        addedSequence: 1,
      },
    ],
  };
}

function withCashPayment(draft: OrderDraft): OrderDraft {
  return {
    ...draft,
    payment: {
      mode: 'SINGLE',
      methodId: CASH_ID,
      cashReceivedMinor: moneyMinor(20_000),
    },
  };
}

async function saveDraft(service: OperationsOrdersService, draft: OrderDraft): Promise<OrderDraft> {
  const result = await service.saveDraft(draft);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

function scalar(databasePath: string, sql: string): number {
  const inspector = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const result = inspector.prepare(sql).get() as Record<string, unknown> | undefined;
    return Number(result?.['value'] ?? 0);
  } finally {
    inspector.close();
  }
}

function failingInventoryDatabase(base: SqliteOperationsDatabase): OperationsDatabase {
  return {
    initialize: () => base.initialize(),
    close: async () => undefined,
    transaction: <Result>(
      work: (transaction: OperationsTransaction) => Promise<Result>,
    ): Promise<Result> =>
      base.transaction((transaction) =>
        work({
          ...transaction,
          inventory: {
            ...transaction.inventory,
            appendMovement: async () => {
              throw new Error('Injected inventory movement failure.');
            },
          },
        }),
      ),
  };
}

describe('OperationsOrdersService with SQLite', () => {
  it('keeps validation failure mutation-free and preserves the durable draft', async () => {
    const { databasePath, draftStore, service } = await fixture();
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const saved = await saveDraft(service, withSingleBurger(workspace.value.draft));
    const result = await service.placeOrder(saved);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected checkout validation to fail.');
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.validationIssues?.some((issue) => issue.path === 'payment')).toBe(true);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(0);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(0);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(0);
    expect(
      scalar(
        databasePath,
        'SELECT last_allocated_display_order_no AS value FROM business_days LIMIT 1',
      ),
    ).toBe(0);

    const persisted = await draftStore.get({
      shopId: SHOP_ID,
      businessDayId: BUSINESS_DAY_ID,
      draftScopeId: DRAFT_SCOPE,
    });
    expect(persisted?.checkoutIntentKey).toBe(saved.checkoutIntentKey);
    expect(persisted?.lines).toHaveLength(1);
  });

  it('commits a Cash order, exact inventory usage, audit and outbox exactly once', async () => {
    const { databasePath, service } = await fixture();
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const saved = await saveDraft(
      service,
      withCashPayment(withSingleBurger(workspace.value.draft)),
    );
    const result = await service.placeOrder(saved);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.replayed).toBe(false);
    expect(result.value.order.displayOrderNo).toBe(1);
    expect(result.value.order.operatorWorkerId).toBe(WORKER_ID);
    expect(result.value.order.operatorName).toBe('Ahmed');
    expect(result.value.order.totalMinor).toBe(moneyMinor(16_000));
    expect(result.value.order.payments).toHaveLength(1);
    const payment = result.value.order.payments[0];
    expect(payment?.method.logicType).toBe('CASH');
    expect(payment?.allocatedMinor).toBe(moneyMinor(16_000));
    expect(payment?.receivedMinor).toBe(moneyMinor(20_000));
    expect(payment?.changeMinor).toBe(moneyMinor(4_000));

    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(1);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(1);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM audit_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        'SELECT last_allocated_display_order_no AS value FROM business_days LIMIT 1',
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        'SELECT quantity_delta_micros AS value FROM inventory_movements LIMIT 1',
      ),
    ).toBe(-500_000);
    expect(result.value.nextDraft.lines).toHaveLength(0);
    expect(result.value.nextDraft.payment).toEqual({ mode: 'NONE' });
    expect(result.value.nextDraft.orderTypeId).toBe(TAKE_AWAY_ID);
    expect(result.value.nextDraft.checkoutIntentKey).not.toBe(saved.checkoutIntentKey);
  });

  it('replays a stale committed intent without duplicating effects or deleting a newer draft', async () => {
    const { databasePath, draftStore, service } = await fixture();
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const committedDraft = await saveDraft(
      service,
      withCashPayment(withSingleBurger(workspace.value.draft)),
    );
    const first = await service.placeOrder(committedDraft);
    if (!first.ok) throw new Error(first.error.message);

    const newerDraft = await saveDraft(service, withSingleBurger(first.value.nextDraft));
    const replay = await service.placeOrder(committedDraft);

    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error(replay.error.message);
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.order.id).toBe(first.value.order.id);
    expect(replay.value.nextDraft.checkoutIntentKey).toBe(newerDraft.checkoutIntentKey);
    expect(replay.value.nextDraft.lines).toHaveLength(1);
    expect(replay.value.postCommitWarnings).toContain('DRAFT_SCOPE_ADVANCED');
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(1);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(1);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(1);
    expect(
      scalar(
        databasePath,
        'SELECT last_allocated_display_order_no AS value FROM business_days LIMIT 1',
      ),
    ).toBe(1);

    const persisted = await draftStore.get({
      shopId: SHOP_ID,
      businessDayId: BUSINESS_DAY_ID,
      draftScopeId: DRAFT_SCOPE,
    });
    expect(persisted?.checkoutIntentKey).toBe(newerDraft.checkoutIntentKey);
    expect(persisted?.lines).toHaveLength(1);
  });

  it('rolls back order allocation and all business effects when inventory persistence fails', async () => {
    const { databasePath, draftStore, service } = await fixture(failingInventoryDatabase);
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const saved = await saveDraft(
      service,
      withCashPayment(withSingleBurger(workspace.value.draft)),
    );
    const result = await service.placeOrder(saved);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected durable checkout to fail.');
    expect(result.error.code).toBe('LOCAL_PERSISTENCE_ERROR');
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM orders')).toBe(0);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM inventory_movements')).toBe(0);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM audit_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(0);
    expect(
      scalar(
        databasePath,
        "SELECT COUNT(*) AS value FROM outbox_events WHERE event_type = 'ORDER_PLACED'",
      ),
    ).toBe(0);
    expect(
      scalar(
        databasePath,
        'SELECT last_allocated_display_order_no AS value FROM business_days LIMIT 1',
      ),
    ).toBe(0);

    const persisted = await draftStore.get({
      shopId: SHOP_ID,
      businessDayId: BUSINESS_DAY_ID,
      draftScopeId: DRAFT_SCOPE,
    });
    expect(persisted?.checkoutIntentKey).toBe(saved.checkoutIntentKey);
    expect(persisted?.lines).toHaveLength(1);
  });

  it('learns a normalized Delivery contact only after the durable order commit succeeds', async () => {
    const { database, databasePath, service } = await fixture();
    const workspace = await service.loadWorkspace(DRAFT_SCOPE);
    if (!workspace.ok) throw new Error(workspace.error.message);

    const deliveryDraft: OrderDraft = {
      ...withSingleBurger(workspace.value.draft),
      orderTypeId: DELIVERY_ID,
      delivery: {
        displayPhone: '+20 100 123 4567',
        normalizedPhone: '',
        customerName: 'Mona',
        address: '12 Test Street',
        zoneId: ZONE_ID,
        zoneLabel: 'Zone A',
        configuredFeeMinor: moneyMinor(3_000),
        finalFeeMinor: moneyMinor(2_500),
      },
      payment: { mode: 'SINGLE', methodId: DIGITAL_ID, cashReceivedMinor: null },
    };
    const saved = await saveDraft(service, deliveryDraft);

    const before = await database.transaction((transaction) =>
      transaction.customerContacts.getByNormalizedPhone(SHOP_ID, '01001234567'),
    );
    expect(before).toBeNull();

    const result = await service.placeOrder(saved);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.order.fulfillment.behavior).toBe('DELIVERY');
    if (result.value.order.fulfillment.behavior !== 'DELIVERY') {
      throw new Error('Expected Delivery fulfillment.');
    }
    expect(result.value.order.fulfillment.delivery.normalizedPhone).toBe('01001234567');
    expect(result.value.order.fulfillment.delivery.configuredFeeMinor).toBe(moneyMinor(3_000));
    expect(result.value.order.fulfillment.delivery.finalFeeMinor).toBe(moneyMinor(2_500));
    expect(result.value.order.totalMinor).toBe(moneyMinor(18_500));

    const contact = await database.transaction((transaction) =>
      transaction.customerContacts.getByNormalizedPhone(SHOP_ID, '01001234567'),
    );
    expect(contact?.name).toBe('Mona');
    expect(contact?.latestAddress).toBe('12 Test Street');
    expect(contact?.latestZoneId).toBe(ZONE_ID);
    expect(scalar(databasePath, 'SELECT COUNT(*) AS value FROM customer_contacts')).toBe(1);
  });
});
