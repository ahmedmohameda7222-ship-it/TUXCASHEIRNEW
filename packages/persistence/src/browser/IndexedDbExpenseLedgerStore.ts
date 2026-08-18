import {
  toExpenseLedgerRecord,
  type BusinessDay,
  type BusinessDayId,
  type Expense,
  type ExpenseId,
  type ExpenseLedgerRecord,
  type WorkerSession,
} from '@tux/domain';
import type { ExpenseLedgerMutation, ExpenseLedgerStore } from '../expenseLedgerStore';

function requestResult<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener(
      'abort',
      () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.')),
      { once: true },
    );
    transaction.addEventListener(
      'error',
      () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')),
      { once: true },
    );
  });
}

async function recordOrNull<Value>(request: IDBRequest<unknown>): Promise<Value | null> {
  const value = await requestResult(request);
  return value === undefined ? null : (value as Value);
}

function openExistingDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let unexpectedUpgrade = false;
    request.addEventListener('upgradeneeded', () => {
      unexpectedUpgrade = true;
      request.transaction?.abort();
    });
    request.addEventListener(
      'success',
      () => {
        if (unexpectedUpgrade) {
          request.result.close();
          reject(new Error('Operations IndexedDB must be initialized before the Expense ledger store.'));
          return;
        }
        resolve(request.result);
      },
      { once: true },
    );
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('Could not open Operations IndexedDB.')),
      { once: true },
    );
  });
}

export class IndexedDbExpenseLedgerStore implements ExpenseLedgerStore {
  readonly #name: string;
  #database: IDBDatabase | null = null;

  constructor(name = 'tux-operations-v2') {
    this.#name = name;
  }

  async initialize(): Promise<void> {
    if (this.#database !== null) return;
    this.#database = await openExistingDatabase(this.#name);
  }

  async getById(id: ExpenseId): Promise<ExpenseLedgerRecord | null> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['expenses'], 'readonly');
    const expense = await recordOrNull<Expense>(transaction.objectStore('expenses').get(id));
    return expense === null ? null : toExpenseLedgerRecord(expense);
  }

  async listByBusinessDay(businessDayId: BusinessDayId): Promise<readonly ExpenseLedgerRecord[]> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(['expenses'], 'readonly');
    const all = (await requestResult(
      transaction.objectStore('expenses').index('businessDayId').getAll(businessDayId),
    )) as Expense[];
    return all
      .map(toExpenseLedgerRecord)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
      );
  }

  async commitMutation(mutation: ExpenseLedgerMutation): Promise<void> {
    const database = this.#requiredDatabase();
    const transaction = database.transaction(
      ['businessDays', 'workerSessions', 'expenses', 'auditEvents', 'outboxEvents'],
      'readwrite',
      { durability: 'strict' },
    );
    const completion = transactionDone(transaction);
    try {
      const day = await recordOrNull<BusinessDay>(
        transaction.objectStore('businessDays').get(mutation.expectedBusinessDayId),
      );
      if (
        day === null ||
        day.status !== 'OPEN' ||
        day.shopId !== mutation.expense.shopId ||
        mutation.expense.businessDayId !== mutation.expectedBusinessDayId
      ) {
        throw new Error('The Business Day changed before the expense mutation committed.');
      }
      const sessions = (await requestResult(
        transaction.objectStore('workerSessions').getAll(),
      )) as WorkerSession[];
      if (
        !sessions.some(
          (session) =>
            session.businessDayId === mutation.expectedBusinessDayId &&
            session.workerId === mutation.expectedWorkerId &&
            session.endedAt === null,
        )
      ) {
        throw new Error('The Current Operator changed before the expense mutation committed.');
      }

      const expenses = transaction.objectStore('expenses');
      const existing = await recordOrNull<Expense>(expenses.get(mutation.expense.id));
      if (mutation.action === 'CREATE') {
        if (existing !== null || mutation.expectedRevision !== null) {
          throw new Error('Expense create conflicted with existing local state.');
        }
        await requestResult(expenses.add(mutation.expense));
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
        await requestResult(expenses.put(mutation.expense));
      }
      await requestResult(transaction.objectStore('auditEvents').add(mutation.audit));
      await requestResult(transaction.objectStore('outboxEvents').add(mutation.outbox));
      await completion;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Transaction may already have failed; original error remains authoritative.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    this.#database?.close();
    this.#database = null;
  }

  #requiredDatabase(): IDBDatabase {
    if (this.#database === null) {
      throw new Error('IndexedDB Expense ledger store must be initialized before use.');
    }
    return this.#database;
  }
}
