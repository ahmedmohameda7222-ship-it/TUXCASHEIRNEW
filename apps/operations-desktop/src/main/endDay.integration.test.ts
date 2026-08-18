import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEmptyOrderDraft, OperationsEndDayService } from '@tux/application';
import {
  allocateDisplayOrderNo,
  createOpenBusinessDay,
  instant,
  moneyMinor,
  parseEntityId,
  wholeStockUnits,
  type BusinessDayId,
  type DraftLineId,
  type Expense,
  type ExpenseId,
  type InventoryItemId,
  type InventoryMovement,
  type InventoryMovementId,
  type MenuCategoryId,
  type OperationsConfigurationSnapshot,
  type OrderId,
  type OrderItemId,
  type OrderSnapshot,
  type OrderTypeId,
  type OutboxEventId,
  type PaymentId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteExpenseLedgerStore,
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteOrderDraftStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('14000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('24000000-0000-4000-8000-000000000001');
const SESSION_ID = parseEntityId<WorkerSessionId>('34000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('44000000-0000-4000-8000-000000000001');
const CATEGORY_ID = parseEntityId<MenuCategoryId>('54000000-0000-4000-8000-000000000001');
const PRODUCT_ID = parseEntityId<ProductId>('64000000-0000-4000-8000-000000000001');
const BULK_ITEM_ID = parseEntityId<InventoryItemId>('74000000-0000-4000-8000-000000000001');
const TAKE_AWAY_ID = parseEntityId<OrderTypeId>('84000000-0000-4000-8000-000000000001');
const CASH_ID = parseEntityId<PaymentMethodId>('94000000-0000-4000-8000-000000000001');
const DIGITAL_ID = parseEntityId<PaymentMethodId>('94000000-0000-4000-8000-000000000002');
const DRAFT_LINE_ID = parseEntityId<DraftLineId>('a4000000-0000-4000-8000-000000000001');
const DRAFT_SCOPE = 'desktop-main-window';
const STARTED_AT = instant('2026-08-18T13:00:00.000Z');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
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
        name: 'Burger',
        description: 'Burger',
        priceMinor: moneyMinor(10_000),
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
        id: TAKE_AWAY_ID,
        shopId: SHOP_ID,
        name: 'Take Away',
        behavior: 'TAKE_AWAY',
        active: true,
        sortOrder: 0,
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
    deliveryZones: [],
  };
}

function order(input: {
  readonly id: string;
  readonly displayOrderNo: number;
  readonly status: OrderSnapshot['status'];
  readonly cashMinor: number;
  readonly digitalMinor: number;
}): OrderSnapshot {
  const totalMinor = moneyMinor(input.cashMinor + input.digitalMinor);
  const suffix = String(input.displayOrderNo).padStart(12, '0');
  return {
    id: parseEntityId<OrderId>(input.id),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    displayOrderNo: input.displayOrderNo,
    idempotencyKey: `fixture:${input.id}`,
    status: input.status,
    source: 'POS',
    operatorWorkerId: WORKER_ID,
    operatorName: 'Ahmed',
    createdAt: instant(`2026-08-18T${14 + input.displayOrderNo}:00:00.000Z`),
    fulfillment: {
      orderTypeId: TAKE_AWAY_ID,
      orderTypeLabel: 'Take Away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: parseEntityId<OrderItemId>(`b4000000-0000-4000-8000-${suffix}`),
        productId: PRODUCT_ID,
        productName: 'Burger',
        unitPriceMinor: totalMinor,
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: totalMinor,
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor,
    payments: [
      ...(input.cashMinor === 0
        ? []
        : [
            {
              id: parseEntityId<PaymentId>(`c4000000-0000-4000-8000-${suffix}`),
              method: { id: CASH_ID, label: 'Cash', logicType: 'CASH' as const },
              allocatedMinor: moneyMinor(input.cashMinor),
              receivedMinor: moneyMinor(input.cashMinor),
              changeMinor: moneyMinor(0),
            },
          ]),
      ...(input.digitalMinor === 0
        ? []
        : [
            {
              id: parseEntityId<PaymentId>(`d4000000-0000-4000-8000-${suffix}`),
              method: { id: DIGITAL_ID, label: 'Instapay', logicType: 'DIGITAL' as const },
              allocatedMinor: moneyMinor(input.digitalMinor),
              receivedMinor: null,
              changeMinor: null,
            },
          ]),
    ],
  };
}

function rows(
  databasePath: string,
  sql: string,
  ...parameters: string[]
): Record<string, unknown>[] {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all(...parameters) as Record<string, unknown>[];
  } finally {
    database.close();
  }
}

async function fixture(uuidSequence: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-end-day-'));
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  const draftStore = new SqliteOrderDraftStore(databasePath);
  await draftStore.initialize();
  const expenseStore = new SqliteExpenseLedgerStore(databasePath);
  await expenseStore.initialize();

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
        id: DAY_ID,
        shopId: SHOP_ID,
        startedAt: STARTED_AT,
        startedByWorkerId: WORKER_ID,
      }),
    );
    await transaction.workerSessions.put({
      id: SESSION_ID,
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      startedAt: STARTED_AT,
      endedAt: null,
    });
    await transaction.configuration.put(configuration());
    await transaction.inventory.putItem({
      id: BULK_ITEM_ID,
      shopId: SHOP_ID,
      name: 'Fries Bags',
      unitLabel: 'bags',
      trackingMode: 'BULK_MANUAL',
      active: true,
    });
    const bulkMovement: InventoryMovement = {
      id: parseEntityId<InventoryMovementId>('e4000000-0000-4000-8000-000000000001'),
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      itemId: BULK_ITEM_ID,
      movementType: 'BULK_STOCK_RECEIVED',
      quantityDeltaMicros: wholeStockUnits(5),
      idempotencyKey: 'fixture:bulk-stock',
      workerId: WORKER_ID,
      orderId: null,
      createdAt: instant('2026-08-18T13:30:00.000Z'),
      compensatesMovementId: null,
    };
    await transaction.inventory.appendMovement(bulkMovement);
  });

  let now = instant('2026-08-19T02:30:00.000Z');
  const ids = [...uuidSequence];
  const service = new OperationsEndDayService(database, readModel, draftStore, expenseStore, {
    now: () => now,
    createUuid: () => ids.shift() ?? randomUUID(),
  });

  cleanup.push(async () => {
    await expenseStore.close();
    await draftStore.close();
    await readModel.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    database,
    databasePath,
    draftStore,
    service,
    setNow(value: string) {
      now = instant(value);
    },
  };
}

async function putOrder(fx: Awaited<ReturnType<typeof fixture>>, value: OrderSnapshot) {
  await fx.database.transaction((transaction) => transaction.orders.insert(value));
}

async function putCashExpense(fx: Awaited<ReturnType<typeof fixture>>, amount: number) {
  const expense: Expense = {
    id: parseEntityId<ExpenseId>('f4000000-0000-4000-8000-000000000001'),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    kind: 'MANUAL',
    description: 'Taxi',
    amountMinor: moneyMinor(amount),
    paidFrom: 'CASH',
    note: null,
    orderId: null,
    createdByWorkerId: WORKER_ID,
    createdAt: instant('2026-08-18T22:00:00.000Z'),
  };
  await fx.database.transaction((transaction) => transaction.expenses.put(expense));
}

const exactActuals = [
  { paymentMethodId: CASH_ID, actualMinor: moneyMinor(7_500) },
  { paymentMethodId: DIGITAL_ID, actualMinor: moneyMinor(5_000) },
] as const;

const noVarianceReasons = [
  { paymentMethodId: CASH_ID, reason: null },
  { paymentMethodId: DIGITAL_ID, reason: null },
] as const;

describe('Operations End Day SQLite integration', () => {
  it('hard-blocks Active orders before reconciliation and leaks no expected values', async () => {
    const fx = await fixture();
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000001',
        displayOrderNo: 1,
        status: 'ACTIVE',
        cashMinor: 10_000,
        digitalMinor: 0,
      }),
    );

    const gate = await fx.service.beginEndDay(DRAFT_SCOPE);
    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.value).toEqual({
      kind: 'ACTIVE_ORDERS_BLOCKED',
      businessDayId: DAY_ID,
      activeOrderNos: [1],
    });
    expect(JSON.stringify(gate.value)).not.toContain('expectedMinor');
    expect(rows(fx.databasePath, 'SELECT id FROM reconciliations')).toHaveLength(0);
  });

  it('requires explicit draft discard and never silently loses the draft', async () => {
    const fx = await fixture();
    const draft = createEmptyOrderDraft({
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      configuration: configuration(),
      now: instant('2026-08-19T02:00:00.000Z'),
      checkoutIntentKey: randomUUID(),
    });
    await fx.draftStore.put({
      ...draft,
      lines: [
        {
          id: DRAFT_LINE_ID,
          productId: PRODUCT_ID,
          productName: 'Burger',
          unitPriceMinor: moneyMinor(10_000),
          quantity: 1,
          modifiers: [],
          comboBeverages: [],
          itemNote: null,
          addedSequence: 1,
        },
      ],
    });

    const blocked = await fx.service.beginEndDay(DRAFT_SCOPE);
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) return;
    expect(blocked.value.kind).toBe('UNFINISHED_DRAFT');
    expect(
      await fx.draftStore.get({
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        draftScopeId: DRAFT_SCOPE,
      }),
    ).not.toBeNull();

    expect(await fx.service.discardDraft(DRAFT_SCOPE)).toEqual({ ok: true, value: true });
    expect(
      await fx.draftStore.get({
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        draftScopeId: DRAFT_SCOPE,
      }),
    ).toBeNull();
    const ready = await fx.service.beginEndDay(DRAFT_SCOPE);
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.value.kind).toBe('READY');
    expect(JSON.stringify(ready.value)).not.toContain('expectedMinor');
  });

  it('reveals exact Cash/Instapay expectations only after blind actual submission', async () => {
    const fx = await fixture();
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000002',
        displayOrderNo: 2,
        status: 'DONE',
        cashMinor: 10_000,
        digitalMinor: 5_000,
      }),
    );
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000003',
        displayOrderNo: 3,
        status: 'CANCELLED',
        cashMinor: 20_000,
        digitalMinor: 0,
      }),
    );
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000004',
        displayOrderNo: 4,
        status: 'RETURNED',
        cashMinor: 0,
        digitalMinor: 30_000,
      }),
    );
    await putCashExpense(fx, 2_500);

    const preview = await fx.service.previewReconciliation({
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      actualPayments: exactActuals,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.recognizedSalesMinor).toBe(moneyMinor(15_000));
    expect(preview.value.totalExpensesMinor).toBe(moneyMinor(2_500));
    expect(preview.value.cashExpensesMinor).toBe(moneyMinor(2_500));
    expect(preview.value.lines).toEqual([
      {
        paymentMethod: { id: CASH_ID, label: 'Cash', logicType: 'CASH' },
        expectedMinor: moneyMinor(7_500),
        actualMinor: moneyMinor(7_500),
        differenceMinor: moneyMinor(0),
        varianceReason: null,
      },
      {
        paymentMethod: { id: DIGITAL_ID, label: 'Instapay', logicType: 'DIGITAL' },
        expectedMinor: moneyMinor(5_000),
        actualMinor: moneyMinor(5_000),
        differenceMinor: moneyMinor(0),
        varianceReason: null,
      },
    ]);
  });

  it('requires a reason for non-zero variance without turning variance into an Expense', async () => {
    const fx = await fixture();
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000005',
        displayOrderNo: 5,
        status: 'DONE',
        cashMinor: 10_000,
        digitalMinor: 0,
      }),
    );

    const result = await fx.service.closeDay({
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      actualPayments: [
        { paymentMethodId: CASH_ID, actualMinor: moneyMinor(9_500) },
        { paymentMethodId: DIGITAL_ID, actualMinor: moneyMinor(0) },
      ],
      varianceReasons: [
        { paymentMethodId: CASH_ID, reason: '' },
        { paymentMethodId: DIGITAL_ID, reason: null },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(
      (await fx.database.transaction((transaction) => transaction.businessDays.getById(DAY_ID)))
        ?.status,
    ).toBe('OPEN');
    expect(rows(fx.databasePath, 'SELECT id FROM reconciliations')).toHaveLength(0);
    expect(rows(fx.databasePath, 'SELECT id FROM expenses')).toHaveLength(0);
  });

  it('closes locally across midnight, ends the operator, preserves Bulk Stock, and replays idempotently', async () => {
    const fx = await fixture();
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000006',
        displayOrderNo: 6,
        status: 'DONE',
        cashMinor: 10_000,
        digitalMinor: 5_000,
      }),
    );
    await putCashExpense(fx, 2_500);
    const movementsBefore = rows(fx.databasePath, 'SELECT id FROM inventory_movements').length;

    const result = await fx.service.closeDay({
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      actualPayments: exactActuals,
      varianceReasons: noVarianceReasons,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.replayed).toBe(false);
    expect(result.value.closedAt).toBe('2026-08-19T02:30:00.000Z');

    const day = await fx.database.transaction((transaction) =>
      transaction.businessDays.getById(DAY_ID),
    );
    expect(day?.status).toBe('CLOSED');
    expect(
      await fx.database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(SHOP_ID),
      ),
    ).toBeNull();
    expect(
      rows(fx.databasePath, 'SELECT ended_at FROM worker_sessions WHERE id = ?', SESSION_ID)[0]?.[
        'ended_at'
      ],
    ).toBe('2026-08-19T02:30:00.000Z');
    expect(
      rows(fx.databasePath, 'SELECT id FROM reconciliations WHERE business_day_id = ?', DAY_ID),
    ).toHaveLength(1);
    expect(
      rows(fx.databasePath, "SELECT id FROM audit_events WHERE event_type = 'BUSINESS_DAY_CLOSED'"),
    ).toHaveLength(1);
    expect(
      rows(
        fx.databasePath,
        "SELECT id FROM outbox_events WHERE event_type = 'BUSINESS_DAY_CLOSED'",
      ),
    ).toHaveLength(1);
    expect(rows(fx.databasePath, 'SELECT id FROM inventory_movements')).toHaveLength(
      movementsBefore,
    );

    const replay = await fx.service.closeDay({
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      actualPayments: exactActuals,
      varianceReasons: noVarianceReasons,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.replayed).toBe(true);
    expect(
      rows(fx.databasePath, 'SELECT id FROM reconciliations WHERE business_day_id = ?', DAY_ID),
    ).toHaveLength(1);
    expect(
      rows(
        fx.databasePath,
        "SELECT id FROM outbox_events WHERE event_type = 'BUSINESS_DAY_CLOSED'",
      ),
    ).toHaveLength(1);

    const nextDay = createOpenBusinessDay({
      id: parseEntityId<BusinessDayId>('44000000-0000-4000-8000-000000000002'),
      shopId: SHOP_ID,
      startedAt: instant('2026-08-19T13:00:00.000Z'),
      startedByWorkerId: WORKER_ID,
    });
    expect(allocateDisplayOrderNo(nextDay).displayOrderNo).toBe(1);
  });

  it('rolls the entire close back when durable outbox persistence fails', async () => {
    const ids = [
      '16400000-0000-4000-8000-000000000001',
      '16400000-0000-4000-8000-000000000002',
      '16400000-0000-4000-8000-000000000003',
      '16400000-0000-4000-8000-000000000004',
      '16400000-0000-4000-8000-000000000005',
      '16400000-0000-4000-8000-000000000006',
      '16400000-0000-4000-8000-000000000007',
    ];
    const fx = await fixture(ids);
    await putOrder(
      fx,
      order({
        id: '15400000-0000-4000-8000-000000000007',
        displayOrderNo: 7,
        status: 'DONE',
        cashMinor: 0,
        digitalMinor: 0,
      }),
    );
    const conflictingOutboxId = parseEntityId<OutboxEventId>(ids[4]!);
    await fx.database.transaction((transaction) =>
      transaction.outbox.append({
        id: conflictingOutboxId,
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        aggregateType: 'TEST',
        aggregateId: 'seed',
        eventType: 'SEED',
        idempotencyKey: 'seed:end-day-conflict',
        payloadVersion: 1,
        payload: { seeded: true },
        createdAt: STARTED_AT,
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        deliveredAt: null,
      }),
    );

    const result = await fx.service.closeDay({
      businessDayId: DAY_ID,
      draftScopeId: DRAFT_SCOPE,
      actualPayments: [
        { paymentMethodId: CASH_ID, actualMinor: moneyMinor(0) },
        { paymentMethodId: DIGITAL_ID, actualMinor: moneyMinor(0) },
      ],
      varianceReasons: noVarianceReasons,
    });
    expect(result.ok).toBe(false);
    expect(
      (await fx.database.transaction((transaction) => transaction.businessDays.getById(DAY_ID)))
        ?.status,
    ).toBe('OPEN');
    expect(
      rows(fx.databasePath, 'SELECT ended_at FROM worker_sessions WHERE id = ?', SESSION_ID)[0]?.[
        'ended_at'
      ],
    ).toBeNull();
    expect(rows(fx.databasePath, 'SELECT id FROM reconciliations')).toHaveLength(0);
    expect(
      rows(fx.databasePath, "SELECT id FROM audit_events WHERE event_type = 'BUSINESS_DAY_CLOSED'"),
    ).toHaveLength(0);
  });
});
