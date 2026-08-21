import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsBulkStockService,
  OperationsConfigurationSyncService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  err,
  type OperationsSessionResult,
} from '@tux/application';
import { instant, type ShopId } from '@tux/domain';
import {
  IndexedDbBulkStockStore,
  IndexedDbExpenseLedgerStore,
  IndexedDbOperationsDatabase,
  IndexedDbOperatorSessionReadModel,
  IndexedDbOrderDraftStore,
} from '@tux/persistence/browser';
import type {
  TuxBulkStockApi,
  TuxEndDayApi,
  TuxExpensesApi,
  TuxOrdersApi,
  TuxOrdersBoardApi,
} from '@tux/platform-contracts';
import { startBrowserAutomaticSync } from './automaticSync';
import { VercelBrowserRemoteGateway } from './browserRemote';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  enrollDevice?(enrollmentCode: string): Promise<OperationsSessionResult>;
}

export type OperationsOrdersClient = TuxOrdersApi;
export type OperationsOrdersBoardClient = TuxOrdersBoardApi;
export type OperationsExpensesClient = TuxExpensesApi;
export type OperationsBulkStockClient = TuxBulkStockApi;
export type OperationsEndDayClient = TuxEndDayApi;

interface BrowserRuntime {
  readonly session: CoordinatedOperationsSessionService;
  readonly orders: OperationsOrdersService;
  readonly ordersBoard: OperationsOrdersBoardService;
  readonly expenses: OperationsExpensesService;
  readonly bulkStock: OperationsBulkStockService;
  readonly endDay: OperationsEndDayService;
  enrollDevice(enrollmentCode: string): Promise<OperationsSessionResult>;
}

let browserRuntimePromise: Promise<BrowserRuntime> | null = null;

async function browserRuntime(): Promise<BrowserRuntime> {
  if (browserRuntimePromise === null) {
    browserRuntimePromise = (async () => {
      const database = new IndexedDbOperationsDatabase();
      await database.initialize();
      const readModel = new IndexedDbOperatorSessionReadModel();
      await readModel.initialize();
      const draftStore = new IndexedDbOrderDraftStore();
      await draftStore.initialize();
      const expenseStore = new IndexedDbExpenseLedgerStore();
      await expenseStore.initialize();
      const bulkStockStore = new IndexedDbBulkStockStore();
      await bulkStockStore.initialize();
      const coordinator = new ApplicationCommandCoordinator();
      const runtime = {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      };

      const remoteGateway = new VercelBrowserRemoteGateway();
      const configurationService = new OperationsConfigurationSyncService(
        database,
        coordinator,
        remoteGateway,
      );
      let automaticSyncStarted = false;
      let configurationTimerStarted = false;

      const startRemoteRuntime = (shopId: ShopId): void => {
        if (!automaticSyncStarted) {
          startBrowserAutomaticSync({ database, now: runtime.now });
          automaticSyncStarted = true;
        }
        if (!configurationTimerStarted) {
          window.setInterval(() => void configurationService.sync(shopId), 5 * 60 * 1000);
          configurationTimerStarted = true;
        }
      };

      try {
        const remoteSession = await remoteGateway.currentSession();
        if (remoteSession !== null) {
          await configurationService.sync(remoteSession.shopId);
          startRemoteRuntime(remoteSession.shopId);
        }
      } catch {
        // Browser Operations stays usable from the last known-good local snapshot.
      }

      const session = new CoordinatedOperationsSessionService(
        database,
        readModel,
        new BrowserPbkdf2PinVerifier(),
        runtime,
        coordinator,
      );

      return {
        session,
        orders: new OperationsOrdersService(
          database,
          readModel,
          draftStore,
          runtime,
          coordinator,
          new BrowserOrderPrinter(),
        ),
        ordersBoard: new OperationsOrdersBoardService(database, readModel, runtime, coordinator),
        expenses: new OperationsExpensesService(
          database,
          readModel,
          expenseStore,
          runtime,
          coordinator,
        ),
        bulkStock: new OperationsBulkStockService(
          database,
          readModel,
          bulkStockStore,
          runtime,
          coordinator,
        ),
        endDay: new OperationsEndDayService(
          database,
          readModel,
          draftStore,
          expenseStore,
          runtime,
          coordinator,
        ),
        enrollDevice: async (enrollmentCode) => {
          try {
            const remoteSession = await remoteGateway.enroll(enrollmentCode);
            const configuration = await configurationService.sync(remoteSession.shopId);
            if (configuration.status === 'REMOTE_UNAVAILABLE') {
              return err({
                code: 'REMOTE_SYNC_ERROR',
                message: 'Device enrolled, but the Operations configuration is unavailable.',
              });
            }
            if (
              configuration.status === 'INVALID_REMOTE_CONFIGURATION' ||
              configuration.status === 'LOCAL_PERSISTENCE_ERROR'
            ) {
              return err({
                code:
                  configuration.status === 'LOCAL_PERSISTENCE_ERROR'
                    ? 'LOCAL_PERSISTENCE_ERROR'
                    : 'REMOTE_SYNC_ERROR',
                message: 'Could not install the Operations configuration on this device.',
              });
            }
            startRemoteRuntime(remoteSession.shopId);
            return session.getState();
          } catch (cause) {
            return err({
              code: 'REMOTE_SYNC_ERROR',
              message:
                cause instanceof Error
                  ? cause.message
                  : 'Could not complete TUX Operations device setup.',
              cause,
            });
          }
        },
      };
    })();
  }
  return browserRuntimePromise;
}

export function createOperationsSessionClient(): OperationsSessionClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.session;
  return {
    getState: async () => (await browserRuntime()).session.getState(),
    submitPin: async (pin: string) => (await browserRuntime()).session.submitPin(pin),
    signOut: async () => (await browserRuntime()).session.signOut(),
    enrollDevice: async (enrollmentCode: string) =>
      (await browserRuntime()).enrollDevice(enrollmentCode),
  };
}

export function createOperationsOrdersClient(): OperationsOrdersClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.orders;
  return {
    loadWorkspace: async (draftScopeId) =>
      (await browserRuntime()).orders.loadWorkspace(draftScopeId),
    saveDraft: async (draft) => (await browserRuntime()).orders.saveDraft(draft),
    findCustomerByPhone: async (shopId, normalizedPhone) =>
      (await browserRuntime()).orders.findCustomerByPhone(shopId, normalizedPhone),
    placeOrder: async (draft) => (await browserRuntime()).orders.placeOrder(draft),
    reprintOrder: async (orderId) => (await browserRuntime()).orders.reprintOrder(orderId),
  };
}

export function createOperationsOrdersBoardClient(): OperationsOrdersBoardClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.ordersBoard;
  return {
    loadBoard: async () => (await browserRuntime()).ordersBoard.loadBoard(),
    markDone: async (orderId) => (await browserRuntime()).ordersBoard.markDone(orderId),
    undoDone: async (orderId) => (await browserRuntime()).ordersBoard.undoDone(orderId),
    cancelOrder: async (input) => (await browserRuntime()).ordersBoard.cancelOrder(input),
    returnDelivery: async (input) => (await browserRuntime()).ordersBoard.returnDelivery(input),
  };
}

export function createOperationsExpensesClient(): OperationsExpensesClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.expenses;
  return {
    loadLedger: async () => (await browserRuntime()).expenses.loadLedger(),
    createExpense: async (input) => (await browserRuntime()).expenses.createExpense(input),
    editExpense: async (input) => (await browserRuntime()).expenses.editExpense(input),
    deleteExpense: async (expenseId) => (await browserRuntime()).expenses.deleteExpense(expenseId),
  };
}

export function createOperationsBulkStockClient(): OperationsBulkStockClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.bulkStock;
  return {
    loadBoard: async () => (await browserRuntime()).bulkStock.loadBoard(),
    finishOne: async (input) => (await browserRuntime()).bulkStock.finishOne(input),
    addStock: async (input) => (await browserRuntime()).bulkStock.addStock(input),
    undoMovement: async (input) => (await browserRuntime()).bulkStock.undoMovement(input),
  };
}

export function createOperationsEndDayClient(): OperationsEndDayClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.endDay;
  return {
    beginEndDay: async (draftScopeId) => (await browserRuntime()).endDay.beginEndDay(draftScopeId),
    discardDraft: async (draftScopeId) =>
      (await browserRuntime()).endDay.discardDraft(draftScopeId),
    previewReconciliation: async (input) =>
      (await browserRuntime()).endDay.previewReconciliation(input),
    closeDay: async (input) => (await browserRuntime()).endDay.closeDay(input),
  };
}
