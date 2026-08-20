import { OperationsEndDayService, type ApplicationCommandCoordinator } from '@tux/application';
import {
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type Instant,
  type PaymentMethodId,
} from '@tux/domain';
import type {
  OperationsDatabase,
  OperatorSessionReadModel,
  OrderDraftStore,
} from '@tux/persistence';
import { SqliteExpenseLedgerStore } from '@tux/persistence/sqlite';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

const IPC_END_DAY_BEGIN = 'tux:end-day:begin';
const IPC_END_DAY_DISCARD_DRAFT = 'tux:end-day:discard-draft';
const IPC_END_DAY_PREVIEW = 'tux:end-day:preview';
const IPC_END_DAY_CLOSE = 'tux:end-day:close';

interface EndDayIpcRuntimeInput {
  readonly databasePath: string;
  readonly database: OperationsDatabase;
  readonly readModel: OperatorSessionReadModel;
  readonly draftStore: OrderDraftStore;
  readonly runtime: {
    now(): Instant;
    createUuid(): string;
  };
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

function assertDraftScope(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('End Day draft scope must be a string.');
  return value;
}

function assertBusinessDayId(value: unknown): BusinessDayId {
  if (typeof value !== 'string') throw new TypeError('End Day Business Day ID must be a string.');
  return parseEntityId<BusinessDayId>(value);
}

function parseActualPayments(value: unknown) {
  if (!Array.isArray(value)) throw new TypeError('End Day actual payments must be an array.');
  return value.map((entry, index) => {
    assertObjectPayload(entry, `End Day actual payment ${index + 1}`);
    if (typeof entry['paymentMethodId'] !== 'string' || typeof entry['actualMinor'] !== 'number') {
      throw new TypeError(`End Day actual payment ${index + 1} is invalid.`);
    }
    return {
      paymentMethodId: parseEntityId<PaymentMethodId>(entry['paymentMethodId']),
      actualMinor: moneyMinor(entry['actualMinor']),
    };
  });
}

function parseVarianceReasons(value: unknown) {
  if (!Array.isArray(value)) throw new TypeError('End Day variance reasons must be an array.');
  return value.map((entry, index) => {
    assertObjectPayload(entry, `End Day variance reason ${index + 1}`);
    if (
      typeof entry['paymentMethodId'] !== 'string' ||
      (entry['reason'] !== null && typeof entry['reason'] !== 'string')
    ) {
      throw new TypeError(`End Day variance reason ${index + 1} is invalid.`);
    }
    return {
      paymentMethodId: parseEntityId<PaymentMethodId>(entry['paymentMethodId']),
      reason: entry['reason'] as string | null,
    };
  });
}

export class EndDayIpcRuntime {
  readonly #expenseStore: SqliteExpenseLedgerStore;
  readonly #service: OperationsEndDayService;

  private constructor(expenseStore: SqliteExpenseLedgerStore, service: OperationsEndDayService) {
    this.#expenseStore = expenseStore;
    this.#service = service;
  }

  static async create(input: EndDayIpcRuntimeInput): Promise<EndDayIpcRuntime> {
    const expenseStore = new SqliteExpenseLedgerStore(input.databasePath);
    await expenseStore.initialize();
    return new EndDayIpcRuntime(
      expenseStore,
      new OperationsEndDayService(
        input.database,
        input.readModel,
        input.draftStore,
        expenseStore,
        input.runtime,
        input.coordinator,
      ),
    );
  }

  register(window: BrowserWindow): void {
    for (const channel of [
      IPC_END_DAY_BEGIN,
      IPC_END_DAY_DISCARD_DRAFT,
      IPC_END_DAY_PREVIEW,
      IPC_END_DAY_CLOSE,
    ]) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle(IPC_END_DAY_BEGIN, async (event, draftScopeId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.beginEndDay(assertDraftScope(draftScopeId));
    });

    ipcMain.handle(IPC_END_DAY_DISCARD_DRAFT, async (event, draftScopeId: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.discardDraft(assertDraftScope(draftScopeId));
    });

    ipcMain.handle(IPC_END_DAY_PREVIEW, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'End Day preview');
      return this.#service.previewReconciliation({
        businessDayId: assertBusinessDayId(input['businessDayId']),
        draftScopeId: assertDraftScope(input['draftScopeId']),
        actualPayments: parseActualPayments(input['actualPayments']),
      });
    });

    ipcMain.handle(IPC_END_DAY_CLOSE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'End Day close');
      return this.#service.closeDay({
        businessDayId: assertBusinessDayId(input['businessDayId']),
        draftScopeId: assertDraftScope(input['draftScopeId']),
        actualPayments: parseActualPayments(input['actualPayments']),
        varianceReasons: parseVarianceReasons(input['varianceReasons']),
      });
    });
  }

  async close(): Promise<void> {
    for (const channel of [
      IPC_END_DAY_BEGIN,
      IPC_END_DAY_DISCARD_DRAFT,
      IPC_END_DAY_PREVIEW,
      IPC_END_DAY_CLOSE,
    ]) {
      ipcMain.removeHandler(channel);
    }
    await this.#expenseStore.close();
  }
}
