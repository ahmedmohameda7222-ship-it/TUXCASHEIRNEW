import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OperationsExpensesService } from '@tux/application';
import {
  closeBusinessDay,
  createOpenBusinessDay,
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type Expense,
  type ExpenseId,
  type OrderId,
  type OutboxEventId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteExpenseLedgerStore,
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';

const SHOP_ID = parseEntityId<ShopId>('12000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('22000000-0000-4000-8000-000000000001');
const SESSION_ID = parseEntityId<WorkerSessionId>('32000000-0000-4000-8000-000000000001');
const DAY_ID = parseEntityId<BusinessDayId>('42000000-0000-4000-8000-000000000001');
const CLOSED_DAY_ID = parseEntityId<BusinessDayId>('42000000-0000-4000-8000-000000000002');
const STARTED_AT = instant('2026-08-18T13:00:00.000Z');
const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function sqlRows(databasePath: string, sql: string, ...params: string[]): Record<string, unknown>[] {
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return raw.prepare(sql).all(...params) as Record<string, unknown>[];
  } finally {
    raw.close();
  }
}

async function fixture(uuidSequence: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-expenses-'));
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  const store = new SqliteExpenseLedgerStore(databasePath);
  await store.initialize();

  const currentDay = createOpenBusinessDay({
    id: DAY_ID,
    shopId: SHOP_ID,
    startedAt: STARTED_AT,
    startedByWorkerId: WORKER_ID,
  });
  const closedDay = closeBusinessDay(
    createOpenBusinessDay({
      id: CLOSED_DAY_ID,
      shopId: SHOP_ID,
      startedAt: instant('2026-08-17T13:00:00.000Z'),
      startedByWorkerId: WORKER_ID,
    }),
    instant('2026-08-18T02:00:00.000Z'),
    WORKER_ID,
  );

  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'fixture-only',
      active: true,
    });
    await transaction.businessDays.put(closedDay);
    await transaction.businessDays.put(currentDay);
    await transaction.workerSessions.put({
      id: SESSION_ID,
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      workerId: WORKER_ID,
      startedAt: STARTED_AT,
      endedAt: null,
    });
  });

  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  let now = instant('2026-08-18T14:00:00.000Z');
  const ids = [...uuidSequence];
  const service = new OperationsExpensesService(database, readModel, store, {
    now: () => now,
    createUuid: () => ids.shift() ?? randomUUID(),
  });

  cleanup.push(async () => {
    await readModel.close();
    await store.close();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  });

  return {
    database,
    databasePath,
    service,
    setNow(value: string) {
      now = instant(value);
    },
  };
}

function systemExpense(id: string): Expense {
  return {
    id: parseEntityId<ExpenseId>(id),
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    kind: 'DELIVERY_FAILED',
    description: 'Delivery Failed — Order #12',
    amountMinor: null,
    paidFrom: null,
    note: 'Customer unavailable',
    orderId: parseEntityId<OrderId>('52000000-0000-4000-8000-000000000001'),
    createdByWorkerId: WORKER_ID,
    createdAt: instant('2026-08-18T14:30:00.000Z'),
  };
}

describe('Operations Expenses SQLite integration', () => {
  it('loads only the current open Business Day and orders entries newest first', async () => {
    const fx = await fixture();
    const historical: Expense = {
      id: parseEntityId<ExpenseId>('62000000-0000-4000-8000-000000000001'),
      shopId: SHOP_ID,
      businessDayId: CLOSED_DAY_ID,
      kind: 'MANUAL',
      description: 'Old shift taxi',
      amountMinor: moneyMinor(10_000),
      paidFrom: 'CASH',
      note: null,
      orderId: null,
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-17T20:00:00.000Z'),
    };
    await fx.database.transaction((transaction) => transaction.expenses.put(historical));

    fx.setNow('2026-08-18T14:01:00.000Z');
    expect(
      (await fx.service.createExpense({
        description: 'Taxi',
        amountMinor: moneyMinor(15_000),
        paidFrom: 'CASH',
        note: null,
      })).ok,
    ).toBe(true);
    fx.setNow('2026-08-18T14:02:00.000Z');
    expect(
      (await fx.service.createExpense({
        description: 'Packaging',
        amountMinor: moneyMinor(20_000),
        paidFrom: 'OTHER',
        note: 'Owner paid',
      })).ok,
    ).toBe(true);

    const ledger = await fx.service.loadLedger();
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.businessDayId).toBe(DAY_ID);
    expect(ledger.value.expenses.map((expense) => expense.description)).toEqual(['Packaging', 'Taxi']);
    expect(ledger.value.totalExpensesMinor).toBe(moneyMinor(35_000));
    expect(ledger.value.cashExpensesMinor).toBe(moneyMinor(15_000));
  });

  it('creates Cash and Other with exact totals plus audit/outbox', async () => {
    const fx = await fixture();
    expect(
      (await fx.service.createExpense({
        description: 'Taxi',
        amountMinor: moneyMinor(15_050),
        paidFrom: 'CASH',
        note: 'Late pickup',
      })).ok,
    ).toBe(true);
    fx.setNow('2026-08-18T14:01:00.000Z');
    expect(
      (await fx.service.createExpense({
        description: 'Ice',
        amountMinor: moneyMinor(9_975),
        paidFrom: 'OTHER',
        note: null,
      })).ok,
    ).toBe(true);

    const ledger = await fx.service.loadLedger();
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.totalExpensesMinor).toBe(moneyMinor(25_025));
    expect(ledger.value.cashExpensesMinor).toBe(moneyMinor(15_050));
    expect(sqlRows(fx.databasePath, "SELECT id FROM audit_events WHERE event_type = 'EXPENSE_CREATED'")).toHaveLength(2);
    expect(sqlRows(fx.databasePath, "SELECT id FROM outbox_events WHERE event_type = 'EXPENSE_CREATED'")).toHaveLength(2);
  });

  it('edits in place while preserving identity/creation and updating exact totals', async () => {
    const fx = await fixture();
    const created = await fx.service.createExpense({
      description: 'Taxi',
      amountMinor: moneyMinor(15_000),
      paidFrom: 'CASH',
      note: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const createdAt = created.value.createdAt;

    fx.setNow('2026-08-18T14:10:00.000Z');
    const edited = await fx.service.editExpense({
      expenseId: created.value.id,
      description: 'Fuel',
      amountMinor: moneyMinor(22_500),
      paidFrom: 'OTHER',
      note: 'Edited correction',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.id).toBe(created.value.id);
    expect(edited.value.createdAt).toBe(createdAt);
    expect(edited.value.lifecycle.revision).toBe(1);

    const ledger = await fx.service.loadLedger();
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.totalExpensesMinor).toBe(moneyMinor(22_500));
    expect(ledger.value.cashExpensesMinor).toBe(moneyMinor(0));
    expect(sqlRows(fx.databasePath, "SELECT id FROM audit_events WHERE event_type = 'EXPENSE_EDITED'")).toHaveLength(1);
  });

  it('soft-deletes from the operational ledger while preserving the database fact', async () => {
    const fx = await fixture();
    const created = await fx.service.createExpense({
      description: 'Mistake',
      amountMinor: moneyMinor(50_000),
      paidFrom: 'CASH',
      note: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    fx.setNow('2026-08-18T14:20:00.000Z');
    const deleted = await fx.service.deleteExpense(created.value.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.lifecycle.deletedAt).toBe('2026-08-18T14:20:00.000Z');

    const ledger = await fx.service.loadLedger();
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.expenses).toHaveLength(0);
    expect(ledger.value.totalExpensesMinor).toBe(moneyMinor(0));

    const rows = sqlRows(fx.databasePath, 'SELECT payload_json FROM expenses WHERE id = ?', created.value.id);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(String(rows[0]?.['payload_json'])) as { lifecycle?: { deletedAt?: unknown } };
    expect(payload.lifecycle?.deletedAt).toBe('2026-08-18T14:20:00.000Z');
    expect(sqlRows(fx.databasePath, "SELECT id FROM audit_events WHERE event_type = 'EXPENSE_DELETED'")).toHaveLength(1);
  });

  it('shows Delivery Failed as locked and non-financial', async () => {
    const fx = await fixture();
    const system = systemExpense('62000000-0000-4000-8000-000000000010');
    await fx.database.transaction((transaction) => transaction.expenses.put(system));

    const ledger = await fx.service.loadLedger();
    expect(ledger.ok).toBe(true);
    if (!ledger.ok) return;
    expect(ledger.value.expenses[0]?.kind).toBe('DELIVERY_FAILED');
    expect(ledger.value.totalExpensesMinor).toBe(moneyMinor(0));
    expect(ledger.value.cashExpensesMinor).toBe(moneyMinor(0));

    expect(
      (await fx.service.editExpense({
        expenseId: system.id,
        description: 'Try edit',
        amountMinor: moneyMinor(1),
        paidFrom: 'CASH',
        note: null,
      })).ok,
    ).toBe(false);
    expect((await fx.service.deleteExpense(system.id)).ok).toBe(false);
  });

  it('rejects historical-day mutation without audit/outbox side effects', async () => {
    const fx = await fixture();
    const historical: Expense = {
      id: parseEntityId<ExpenseId>('62000000-0000-4000-8000-000000000020'),
      shopId: SHOP_ID,
      businessDayId: CLOSED_DAY_ID,
      kind: 'MANUAL',
      description: 'Historical',
      amountMinor: moneyMinor(10_000),
      paidFrom: 'CASH',
      note: null,
      orderId: null,
      createdByWorkerId: WORKER_ID,
      createdAt: instant('2026-08-17T20:00:00.000Z'),
    };
    await fx.database.transaction((transaction) => transaction.expenses.put(historical));
    const deleted = await fx.service.deleteExpense(historical.id);
    expect(deleted.ok).toBe(false);
    if (deleted.ok) return;
    expect(deleted.error.code).toBe('CONFLICT_ERROR');
    expect(sqlRows(fx.databasePath, 'SELECT id FROM audit_events WHERE aggregate_id = ?', historical.id)).toHaveLength(0);
    expect(sqlRows(fx.databasePath, 'SELECT id FROM outbox_events WHERE aggregate_id = ?', historical.id)).toHaveLength(0);
  });

  it('rolls back expense and audit when the outbox insert fails', async () => {
    const EXPENSE_UUID = '72000000-0000-4000-8000-000000000001';
    const AUDIT_UUID = '72000000-0000-4000-8000-000000000002';
    const COLLIDING_OUTBOX_UUID = '72000000-0000-4000-8000-000000000003';
    const fx = await fixture([EXPENSE_UUID, AUDIT_UUID, COLLIDING_OUTBOX_UUID]);
    await fx.database.transaction((transaction) =>
      transaction.outbox.append({
        id: parseEntityId<OutboxEventId>(COLLIDING_OUTBOX_UUID),
        shopId: SHOP_ID,
        businessDayId: DAY_ID,
        aggregateType: 'TEST',
        aggregateId: 'seed',
        eventType: 'SEED',
        idempotencyKey: 'seed:outbox',
        payloadVersion: 1,
        payload: { seeded: true },
        createdAt: STARTED_AT,
        attemptCount: 0,
        nextAttemptAt: null,
        lastError: null,
        deliveredAt: null,
      }),
    );

    const result = await fx.service.createExpense({
      description: 'Should roll back',
      amountMinor: moneyMinor(1000),
      paidFrom: 'CASH',
      note: null,
    });
    expect(result.ok).toBe(false);
    expect(sqlRows(fx.databasePath, 'SELECT id FROM expenses WHERE id = ?', EXPENSE_UUID)).toHaveLength(0);
    expect(sqlRows(fx.databasePath, 'SELECT id FROM audit_events WHERE id = ?', AUDIT_UUID)).toHaveLength(0);
  });
});
