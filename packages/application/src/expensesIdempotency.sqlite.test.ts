import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type ExpenseId,
  type OpenBusinessDay,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import {
  SqliteOperationsDatabase,
  SqliteOperatorSessionReadModel,
  SqliteExpenseLedgerStore,
} from '@tux/persistence/sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import { OperationsExpensesService } from './expenses';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const at = instant('2026-08-20T00:00:00.000Z');
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'tux-expense-idempotency-'));
  directories.push(directory);
  const path = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(path);
  await database.initialize();
  const day: OpenBusinessDay = {
    id: businessDayId,
    shopId,
    status: 'OPEN',
    startedAt: at,
    endedAt: null,
    startedByWorkerId: workerId,
    endedByWorkerId: null,
    lastAllocatedDisplayOrderNo: 0,
  };
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: shopId, name: 'Dev Shop', active: true });
    await transaction.workers.put({
      id: workerId,
      shopId,
      displayName: 'Dev Worker',
      pinHash: 'test-only',
      active: true,
    });
    await transaction.businessDays.put(day);
    await transaction.workerSessions.put({
      id: parseEntityId<WorkerSessionId>('44444444-4444-4444-8444-444444444444'),
      shopId,
      businessDayId,
      workerId,
      startedAt: at,
      endedAt: null,
    });
  });
  const readModel = new SqliteOperatorSessionReadModel(path);
  const store = new SqliteExpenseLedgerStore(path);
  await store.initialize();
  const service = new OperationsExpensesService(
    database,
    readModel,
    store,
    { now: () => at, createUuid: () => '55555555-5555-4555-8555-555555555555' },
    new ApplicationCommandCoordinator(),
  );
  return { path, database, readModel, store, service };
}

function count(path: string, table: string): number {
  const sqlite = new DatabaseSync(path);
  try {
    return Number(
      (sqlite.prepare(`select count(*) as value from ${table}`).get() as Record<string, unknown>)[
        'value'
      ],
    );
  } finally {
    sqlite.close();
  }
}

describe('Manual Expense create idempotency', () => {
  it('replays the same command and payload without duplicate financial/audit/outbox facts', async () => {
    const test = await fixture();
    const commandId = '66666666-6666-4666-8666-666666666666';
    const input = {
      commandId,
      description: 'Cleaning supplies',
      amountMinor: moneyMinor(5000),
      paidFrom: 'CASH' as const,
      note: 'Shift supplies',
    };
    const first = await test.service.createExpense(input);
    const replay = await test.service.createExpense(input);
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.value.id).toBe(parseEntityId<ExpenseId>(commandId));
    expect(replay.value).toEqual(first.value);
    expect(count(test.path, 'expenses')).toBe(1);
    expect(count(test.path, 'audit_events')).toBe(1);
    expect(count(test.path, 'outbox_events')).toBe(1);
  });

  it('rejects conflicting reuse of the same command identity', async () => {
    const test = await fixture();
    const commandId = '77777777-7777-4777-8777-777777777777';
    const first = await test.service.createExpense({
      commandId,
      description: 'Cleaning supplies',
      amountMinor: moneyMinor(5000),
      paidFrom: 'CASH',
      note: null,
    });
    expect(first.ok).toBe(true);
    const conflict = await test.service.createExpense({
      commandId,
      description: 'Different expense',
      amountMinor: moneyMinor(5000),
      paidFrom: 'CASH',
      note: null,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.error.code).toBe('CONFLICT_ERROR');
    expect(count(test.path, 'expenses')).toBe(1);
    expect(count(test.path, 'audit_events')).toBe(1);
    expect(count(test.path, 'outbox_events')).toBe(1);
  });
});
