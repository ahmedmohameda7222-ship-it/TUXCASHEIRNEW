import { OperationsExpensesService, type ApplicationCommandCoordinator } from '@tux/application';
import { moneyMinor, parseEntityId, type ExpenseId, type Instant } from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';
import { SqliteExpenseLedgerStore } from '@tux/persistence/sqlite';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

const IPC_EXPENSES_LOAD = 'tux:expenses:load';
const IPC_EXPENSES_CREATE = 'tux:expenses:create';
const IPC_EXPENSES_EDIT = 'tux:expenses:edit';
const IPC_EXPENSES_DELETE = 'tux:expenses:delete';

interface ExpensesIpcRuntimeInput {
  readonly databasePath: string;
  readonly database: OperationsDatabase;
  readonly readModel: OperatorSessionReadModel;
  readonly runtime: { now(): Instant; createUuid(): string };
  readonly coordinator: ApplicationCommandCoordinator;
}

function assertObjectPayload(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
}

export class ExpensesIpcRuntime {
  readonly #store: SqliteExpenseLedgerStore;
  readonly #service: OperationsExpensesService;

  private constructor(store: SqliteExpenseLedgerStore, service: OperationsExpensesService) {
    this.#store = store;
    this.#service = service;
  }

  static async create(input: ExpensesIpcRuntimeInput): Promise<ExpensesIpcRuntime> {
    const store = new SqliteExpenseLedgerStore(input.databasePath);
    await store.initialize();
    return new ExpensesIpcRuntime(
      store,
      new OperationsExpensesService(
        input.database,
        input.readModel,
        store,
        input.runtime,
        input.coordinator,
      ),
    );
  }

  register(window: BrowserWindow): void {
    for (const channel of [
      IPC_EXPENSES_LOAD,
      IPC_EXPENSES_CREATE,
      IPC_EXPENSES_EDIT,
      IPC_EXPENSES_DELETE,
    ]) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle(IPC_EXPENSES_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.loadLedger();
    });
    ipcMain.handle(IPC_EXPENSES_CREATE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'Create expense');
      if (
        typeof input['commandId'] !== 'string' ||
        typeof input['description'] !== 'string' ||
        typeof input['amountMinor'] !== 'number' ||
        (input['paidFrom'] !== 'CASH' && input['paidFrom'] !== 'OTHER') ||
        (input['note'] !== null && typeof input['note'] !== 'string')
      ) {
        throw new TypeError('Create expense IPC payload is invalid.');
      }
      return this.#service.createExpense({
        commandId: input['commandId'],
        description: input['description'],
        amountMinor: moneyMinor(input['amountMinor']),
        paidFrom: input['paidFrom'],
        note: input['note'] as string | null,
      });
    });
    ipcMain.handle(IPC_EXPENSES_EDIT, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'Edit expense');
      if (
        typeof input['expenseId'] !== 'string' ||
        typeof input['description'] !== 'string' ||
        typeof input['amountMinor'] !== 'number' ||
        (input['paidFrom'] !== 'CASH' && input['paidFrom'] !== 'OTHER') ||
        (input['note'] !== null && typeof input['note'] !== 'string')
      ) {
        throw new TypeError('Edit expense IPC payload is invalid.');
      }
      return this.#service.editExpense({
        expenseId: parseEntityId<ExpenseId>(input['expenseId']),
        description: input['description'],
        amountMinor: moneyMinor(input['amountMinor']),
        paidFrom: input['paidFrom'],
        note: input['note'] as string | null,
      });
    });
    ipcMain.handle(IPC_EXPENSES_DELETE, async (event, expenseId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      if (typeof expenseId !== 'string') {
        throw new TypeError('Delete expense IPC payload must be an Expense ID string.');
      }
      return this.#service.deleteExpense(parseEntityId<ExpenseId>(expenseId));
    });
  }

  async close(): Promise<void> {
    for (const channel of [
      IPC_EXPENSES_LOAD,
      IPC_EXPENSES_CREATE,
      IPC_EXPENSES_EDIT,
      IPC_EXPENSES_DELETE,
    ]) {
      ipcMain.removeHandler(channel);
    }
    await this.#store.close();
  }
}
