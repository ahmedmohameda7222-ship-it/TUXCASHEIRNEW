import {
  DomainInvariantError,
  calculateExpenseTotals,
  createManualExpense,
  deleteManualExpense,
  editManualExpense,
  isExpenseDeleted,
  parseEntityId,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type EntityId,
  type ExpenseId,
  type ExpenseLedgerRecord,
  type ExpensePaidFrom,
  type Instant,
  type JsonValue,
  type ManualExpenseRecord,
  type MoneyMinor,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type Worker,
} from '@tux/domain';
import type {
  ExpenseLedgerStore,
  OperationsDatabase,
  OperatorSessionReadModel,
} from '@tux/persistence';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';

export interface ExpensesRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface ManualExpenseInput {
  readonly description: string;
  readonly amountMinor: MoneyMinor;
  readonly paidFrom: ExpensePaidFrom;
  readonly note: string | null;
}

export interface EditManualExpenseInput extends ManualExpenseInput {
  readonly expenseId: ExpenseId;
}

export interface ExpensesLedger {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly loadedAt: Instant;
  readonly expenses: readonly ExpenseLedgerRecord[];
  readonly totalExpensesMinor: MoneyMinor;
  readonly cashExpensesMinor: MoneyMinor;
}

export type ExpensesLedgerResult = Result<ExpensesLedger, ApplicationError>;
export type ExpenseMutationResult = Result<ManualExpenseRecord, ApplicationError>;

interface MutationContext {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly operator: Worker;
}

function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function domainError(cause: unknown, fallback: string): ApplicationError {
  if (cause instanceof DomainInvariantError) {
    return { code: 'VALIDATION_ERROR', message: cause.message, cause };
  }
  return persistenceError(fallback, cause);
}

export class OperationsExpensesService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #store: ExpenseLedgerStore;
  readonly #runtime: ExpensesRuntime;
  readonly #coordinator: ApplicationCommandCoordinator;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    store: ExpenseLedgerStore,
    runtime: ExpensesRuntime,
    coordinator = new ApplicationCommandCoordinator(),
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#store = store;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
  }

  async loadLedger(): Promise<ExpensesLedgerResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const shops = await this.#readModel.listActiveShops();
        const shop = shops.length === 1 ? shops[0] : undefined;
        if (shop === undefined) {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'This device is not assigned to exactly one active shop.',
          });
        }
        const day = await this.#database.transaction((transaction) =>
          transaction.businessDays.getOpenForShop(shop.id),
        );
        if (day === null || day.status !== 'OPEN') {
          return err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' });
        }
        const records = await this.#store.listByBusinessDay(day.id);
        const expenses = records.filter((expense) => !isExpenseDeleted(expense));
        const totals = calculateExpenseTotals(expenses);
        return ok({
          shopId: shop.id,
          businessDayId: day.id,
          loadedAt: this.#runtime.now(),
          expenses,
          ...totals,
        });
      } catch (cause) {
        return err(persistenceError('Could not load the local Expenses ledger.', cause));
      }
    });
  }

  async createExpense(input: ManualExpenseInput): Promise<ExpenseMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveMutationContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      const now = this.#runtime.now();
      let expense: ManualExpenseRecord;
      try {
        expense = createManualExpense(
          {
            id: this.#id<ExpenseId>(),
            shopId: context.shopId,
            businessDayId: context.businessDayId,
            createdByWorkerId: context.operator.id,
            createdAt: now,
          },
          input,
        );
      } catch (cause) {
        return err(domainError(cause, 'Expense validation failed.'));
      }
      try {
        await this.#store.commitMutation({
          action: 'CREATE',
          expectedBusinessDayId: context.businessDayId,
          expectedWorkerId: context.operator.id,
          expectedRevision: null,
          expense,
          audit: this.#audit(expense, context.operator, now, 'EXPENSE_CREATED'),
          outbox: this.#outbox(expense, now, 'EXPENSE_CREATED'),
        });
        return ok(expense);
      } catch (cause) {
        return err(
          persistenceError('The expense was not saved because the local commit failed.', cause),
        );
      }
    });
  }

  async editExpense(input: EditManualExpenseInput): Promise<ExpenseMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveMutationContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const existing = await this.#currentExpense(context, input.expenseId);
        if (existing.kind !== 'MANUAL') {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'Delivery Failed system records are locked.',
          });
        }
        const now = this.#runtime.now();
        const expense = editManualExpense(existing, input, now, context.operator.id);
        await this.#store.commitMutation({
          action: 'UPDATE',
          expectedBusinessDayId: context.businessDayId,
          expectedWorkerId: context.operator.id,
          expectedRevision: existing.lifecycle.revision,
          expense,
          audit: this.#audit(expense, context.operator, now, 'EXPENSE_EDITED'),
          outbox: this.#outbox(expense, now, 'EXPENSE_EDITED'),
        });
        return ok(expense);
      } catch (cause) {
        return err(domainError(cause, 'The expense changes could not be committed locally.'));
      }
    });
  }

  async deleteExpense(expenseId: ExpenseId): Promise<ExpenseMutationResult> {
    return this.#coordinator.runExclusive(async () => {
      const contextResult = await this.#resolveMutationContext();
      if (!contextResult.ok) return contextResult;
      const context = contextResult.value;
      try {
        const existing = await this.#currentExpense(context, expenseId);
        if (existing.kind !== 'MANUAL') {
          return err({
            code: 'CONFLICT_ERROR',
            message: 'Delivery Failed system records are locked.',
          });
        }
        const now = this.#runtime.now();
        const expense = deleteManualExpense(existing, now, context.operator.id);
        await this.#store.commitMutation({
          action: 'UPDATE',
          expectedBusinessDayId: context.businessDayId,
          expectedWorkerId: context.operator.id,
          expectedRevision: existing.lifecycle.revision,
          expense,
          audit: this.#audit(expense, context.operator, now, 'EXPENSE_DELETED'),
          outbox: this.#outbox(expense, now, 'EXPENSE_DELETED'),
        });
        return ok(expense);
      } catch (cause) {
        if (cause instanceof DomainInvariantError) {
          return err({ code: 'CONFLICT_ERROR', message: cause.message, cause });
        }
        return err(
          persistenceError('The expense could not be removed from the current ledger.', cause),
        );
      }
    });
  }

  async #currentExpense(
    context: MutationContext,
    expenseId: ExpenseId,
  ): Promise<ExpenseLedgerRecord> {
    const expense = await this.#store.getById(expenseId);
    if (
      expense === null ||
      expense.shopId !== context.shopId ||
      expense.businessDayId !== context.businessDayId
    ) {
      throw new DomainInvariantError('The expense is not part of the current Business Day.');
    }
    return expense;
  }

  async #resolveMutationContext(): Promise<Result<MutationContext, ApplicationError>> {
    try {
      const shops = await this.#readModel.listActiveShops();
      const shop = shops.length === 1 ? shops[0] : undefined;
      if (shop === undefined) {
        return err({
          code: 'CONFLICT_ERROR',
          message: 'This device is not assigned to exactly one active shop.',
        });
      }
      const day = await this.#database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(shop.id),
      );
      if (day === null || day.status !== 'OPEN') {
        return err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' });
      }
      const session = await this.#readModel.getOpenWorkerSession(day.id);
      if (session === null || session.endedAt !== null) {
        return err({ code: 'CONFLICT_ERROR', message: 'A Current Operator is required.' });
      }
      const worker = await this.#database.transaction((transaction) =>
        transaction.workers.getById(session.workerId),
      );
      if (worker === null || !worker.active || worker.shopId !== shop.id) {
        return err({ code: 'CONFLICT_ERROR', message: 'The Current Operator is unavailable.' });
      }
      return ok({ shopId: shop.id, businessDayId: day.id, operator: worker });
    } catch (cause) {
      return err(persistenceError('Could not resolve the current Expenses session.', cause));
    }
  }

  #audit(
    expense: ManualExpenseRecord,
    worker: Worker,
    createdAt: Instant,
    eventType: 'EXPENSE_CREATED' | 'EXPENSE_EDITED' | 'EXPENSE_DELETED',
  ): AuditEvent {
    const details: Record<string, JsonValue> = {
      expenseId: expense.id,
      description: expense.description,
      amountMinor: expense.amountMinor,
      paidFrom: expense.paidFrom,
      revision: expense.lifecycle.revision,
      softDeleted: expense.lifecycle.deletedAt !== null,
    };
    return {
      id: this.#id<AuditEventId>(),
      shopId: expense.shopId,
      businessDayId: expense.businessDayId,
      aggregateType: 'EXPENSE',
      aggregateId: expense.id,
      eventType,
      workerId: worker.id,
      createdAt,
      details,
    };
  }

  #outbox(
    expense: ManualExpenseRecord,
    createdAt: Instant,
    eventType: 'EXPENSE_CREATED' | 'EXPENSE_EDITED' | 'EXPENSE_DELETED',
  ): OutboxEvent {
    return {
      id: this.#id<OutboxEventId>(),
      shopId: expense.shopId,
      businessDayId: expense.businessDayId,
      aggregateType: 'EXPENSE',
      aggregateId: expense.id,
      eventType,
      idempotencyKey: `expense:${expense.id}:${expense.lifecycle.revision}:${eventType}`,
      payloadVersion: 1,
      payload: {
        expenseId: expense.id,
        businessDayId: expense.businessDayId,
        description: expense.description,
        amountMinor: expense.amountMinor,
        paidFrom: expense.paidFrom,
        revision: expense.lifecycle.revision,
        softDeleted: expense.lifecycle.deletedAt !== null,
      },
      createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }
}
