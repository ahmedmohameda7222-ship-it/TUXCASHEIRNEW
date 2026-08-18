import { DatabaseSync } from 'node:sqlite';
import {
  toExpenseLedgerRecord,
  type AuditEvent,
  type BusinessDayId,
  type Expense,
  type ExpenseId,
  type ExpenseLedgerRecord,
  type OutboxEvent,
} from '@tux/domain';
import type { ExpenseLedgerMutation, ExpenseLedgerStore } from '../expenseLedgerStore';

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parsePayload<Value>(row: unknown): Value | null {
  if (row === undefined) return null;
  if (typeof row !== 'object' || row === null || !('payload_json' in row)) {
    throw new Error('SQLite expense row is missing payload_json.');
  }
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') throw new Error('SQLite expense payload_json must be text.');
  return JSON.parse(payload) as Value;
}

export class SqliteExpenseLedgerStore implements ExpenseLedgerStore {
  readonly #database: DatabaseSync;
  #initialized = false;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { timeout: 5_000 });
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    this.#database.exec('PRAGMA foreign_keys = ON;');
    this.#database.exec('PRAGMA synchronous = FULL;');
    this.#database.exec('PRAGMA busy_timeout = 5000;');
    this.#initialized = true;
  }

  async getById(id: ExpenseId): Promise<ExpenseLedgerRecord | null> {
    this.#assertInitialized();
    const expense = parsePayload<Expense>(
      this.#database.prepare('SELECT payload_json FROM expenses WHERE id = ?').get(id),
    );
    return expense === null ? null : toExpenseLedgerRecord(expense);
  }

  async listByBusinessDay(businessDayId: BusinessDayId): Promise<readonly ExpenseLedgerRecord[]> {
    this.#assertInitialized();
    return this.#database
      .prepare(
        'SELECT payload_json FROM expenses WHERE business_day_id = ? ORDER BY created_at DESC, id DESC',
      )
      .all(businessDayId)
      .map((row) => parsePayload<Expense>(row))
      .filter((expense): expense is Expense => expense !== null)
      .map(toExpenseLedgerRecord);
  }

  async commitMutation(mutation: ExpenseLedgerMutation): Promise<void> {
    this.#assertInitialized();
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      this.#assertContext(mutation);
      const existing = parsePayload<Expense>(
        this.#database
          .prepare('SELECT payload_json FROM expenses WHERE id = ?')
          .get(mutation.expense.id),
      );
      if (mutation.action === 'CREATE') {
        if (existing !== null || mutation.expectedRevision !== null) {
          throw new Error('Expense create conflicted with existing local state.');
        }
        this.#insertExpense(mutation.expense);
      } else {
        if (existing === null || existing.kind !== 'MANUAL') {
          throw new Error('Only an existing manual expense can be updated.');
        }
        const current = toExpenseLedgerRecord(existing);
        if (
          current.kind !== 'MANUAL' ||
          current.businessDayId !== mutation.expectedBusinessDayId ||
          current.lifecycle.revision !== mutation.expectedRevision
        ) {
          throw new Error('Expense update conflicted with newer local state.');
        }
        this.#database
          .prepare(
            'UPDATE expenses SET amount_minor = ?, paid_from = ?, payload_json = ? WHERE id = ?',
          )
          .run(
            mutation.expense.amountMinor,
            mutation.expense.paidFrom,
            serialize(mutation.expense),
            mutation.expense.id,
          );
      }
      this.#appendAudit(mutation.audit);
      this.#appendOutbox(mutation.outbox);
      this.#database.exec('COMMIT');
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database.close();
    this.#initialized = false;
  }

  #assertInitialized(): void {
    if (!this.#initialized)
      throw new Error('SQLite Expense ledger store must be initialized before use.');
  }

  #assertContext(mutation: ExpenseLedgerMutation): void {
    const day = this.#database
      .prepare('SELECT shop_id, status FROM business_days WHERE id = ?')
      .get(mutation.expectedBusinessDayId) as Record<string, unknown> | undefined;
    if (
      day === undefined ||
      day['status'] !== 'OPEN' ||
      day['shop_id'] !== mutation.expense.shopId ||
      mutation.expense.businessDayId !== mutation.expectedBusinessDayId
    ) {
      throw new Error('The Business Day changed before the expense mutation committed.');
    }
    const session = this.#database
      .prepare(
        'SELECT id FROM worker_sessions WHERE business_day_id = ? AND worker_id = ? AND ended_at IS NULL LIMIT 1',
      )
      .get(mutation.expectedBusinessDayId, mutation.expectedWorkerId);
    if (session === undefined)
      throw new Error('The Current Operator changed before the expense mutation committed.');
  }

  #insertExpense(expense: ExpenseLedgerMutation['expense']): void {
    this.#database
      .prepare(
        `INSERT INTO expenses(id, shop_id, business_day_id, kind, amount_minor, paid_from, order_id, created_at, payload_json)
         VALUES (?, ?, ?, 'MANUAL', ?, ?, NULL, ?, ?)`,
      )
      .run(
        expense.id,
        expense.shopId,
        expense.businessDayId,
        expense.amountMinor,
        expense.paidFrom,
        expense.createdAt,
        serialize(expense),
      );
  }

  #appendAudit(event: AuditEvent): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events(
          id, shop_id, business_day_id, aggregate_type, aggregate_id, event_type, worker_id, created_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.shopId,
        event.businessDayId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.workerId,
        event.createdAt,
        serialize(event),
      );
  }

  #appendOutbox(event: OutboxEvent): void {
    this.#database
      .prepare(
        `INSERT INTO outbox_events(
          id, shop_id, business_day_id, aggregate_type, aggregate_id, event_type, idempotency_key,
          payload_version, payload_json, created_at, attempt_count, next_attempt_at, last_error, delivered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.shopId,
        event.businessDayId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        event.idempotencyKey,
        event.payloadVersion,
        serialize(event),
        event.createdAt,
        event.attemptCount,
        event.nextAttemptAt,
        event.lastError,
        event.deliveredAt,
      );
  }
}
