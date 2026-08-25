import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsBulkStockService,
  OperationsConfigurationSyncService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  WorkerUiPreferencesRetryController,
  WorkerUiPreferencesService,
  err,
  type OperationsSessionResult,
  type WorkerUiPreferencesSyncIdentity,
} from '@tux/application';
import { instant, type ShopId } from '@tux/domain';
import type { WorkerUiPreferencesRepository } from '@tux/persistence';
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
  TuxWorkerUiPreferencesApi,
} from '@tux/platform-contracts';
import { startBrowserAutomaticSync } from './automaticSync';
import { VercelBrowserRemoteGateway } from './browserRemote';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  enrollDevice?(pin: string): Promise<OperationsSessionResult>;
}

export type OperationsWorkerUiPreferencesClient = TuxWorkerUiPreferencesApi;
export type OperationsOrdersClient = TuxOrdersApi;
export type OperationsOrdersBoardClient = TuxOrdersBoardApi;
export type OperationsExpensesClient = TuxExpensesApi;
export type OperationsBulkStockClient = TuxBulkStockApi;
export type OperationsEndDayClient = TuxEndDayApi;

interface BrowserRuntime {
  readonly session: CoordinatedOperationsSessionService;
  readonly workerUiPreferences: TuxWorkerUiPreferencesApi;
  readonly orders: OperationsOrdersService;
  readonly ordersBoard: OperationsOrdersBoardService;
  readonly expenses: OperationsExpensesService;
  readonly bulkStock: OperationsBulkStockService;
  readonly endDay: OperationsEndDayService;
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
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
      const preferencesRepository: WorkerUiPreferencesRepository = {
        get: (shopId, workerId) =>
          database.transaction((transaction) =>
            transaction.workerUiPreferences.get(shopId, workerId),
          ),
        put: (preferences) =>
          database.transaction((transaction) => transaction.workerUiPreferences.put(preferences)),
        delete: (shopId, workerId) =>
          database.transaction((transaction) =>
            transaction.workerUiPreferences.delete(shopId, workerId),
          ),
      };
      const preferencesService = new WorkerUiPreferencesService(
        preferencesRepository,
        remoteGateway,
        runtime.now,
      );
      let activePreferenceIdentity: WorkerUiPreferencesSyncIdentity | null = null;
      const preferencesRetry = new WorkerUiPreferencesRetryController(
        preferencesService,
        () => activePreferenceIdentity,
      );
      let automaticSyncStarted = false;
      let configurationTimerStarted = false;
      let preferenceRetryStarted = false;

      const retryPreferences = (): void => {
        void preferencesRetry.syncActive();
      };

      const startRemoteRuntime = (shopId: ShopId): void => {
        if (!automaticSyncStarted) {
          startBrowserAutomaticSync({ database, now: runtime.now });
          automaticSyncStarted = true;
        }
        if (!configurationTimerStarted) {
          window.setInterval(() => void configurationService.sync(shopId), 5 * 60 * 1000);
          configurationTimerStarted = true;
        }
        if (!preferenceRetryStarted) {
          preferencesRetry.start();
          window.addEventListener('online', retryPreferences);
          preferenceRetryStarted = true;
        }
      };

      const trackPreferenceIdentity = (result: OperationsSessionResult): void => {
        if (!result.ok || result.value.status !== 'ACTIVE' || !preferenceRetryStarted) {
          activePreferenceIdentity = null;
          return;
        }
        activePreferenceIdentity = {
          shopId: result.value.shopId,
          workerId: result.value.operator.id,
        };
        retryPreferences();
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

      const activePreferenceIdentityFromSession = async (): Promise<WorkerUiPreferencesSyncIdentity> => {
        const result = await session.getState();
        if (!result.ok || result.value.status !== 'ACTIVE') {
          throw new Error('Active worker session required.');
        }
        return {
          shopId: result.value.shopId,
          workerId: result.value.operator.id,
        };
      };

      const workerUiPreferences: TuxWorkerUiPreferencesApi = {
        load: async () => {
          const identity = await activePreferenceIdentityFromSession();
          return preferencesRepository.get(identity.shopId, identity.workerId);
        },
        update: async (input) => {
          const identity = await activePreferenceIdentityFromSession();
          const updated = await preferencesService.update(identity.shopId, identity.workerId, input);
          if (preferenceRetryStarted) retryPreferences();
          return updated;
        },
        reset: async () => {
          await workerUiPreferences.update({ categoryOrder: [], categoryAlignment: 'center' });
        },
      };

      const bootstrapWithPin = async (pin: string): Promise<OperationsSessionResult> => {
        try {
          const bootstrap = await remoteGateway.bootstrap(pin);
          await database.transaction(async (transaction) => {
            await transaction.shops.put(bootstrap.shop);
            await transaction.workers.put(bootstrap.worker);
          });

          const configuration = await configurationService.sync(bootstrap.shopId);
          if (configuration.status === 'REMOTE_UNAVAILABLE') {
            return err({
              code: 'REMOTE_SYNC_ERROR',
              message: 'PIN accepted, but the Operations configuration is unavailable.',
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
              message: 'Could not install the Operations configuration on this browser.',
            });
          }
          startRemoteRuntime(bootstrap.shopId);
          return session.submitPin(pin);
        } catch (cause) {
          return err({
            code: 'REMOTE_SYNC_ERROR',
            message:
              cause instanceof Error ? cause.message : 'Could not sign in to TUX Operations.',
            cause,
          });
        }
      };

      const submitPin = async (pin: string): Promise<OperationsSessionResult> => {
        const local = await session.submitPin(pin);
        if (local.ok && local.value.status !== 'CONFIGURATION_REQUIRED') {
          trackPreferenceIdentity(local);
          return local;
        }

        const needsRemoteBootstrap =
          (local.ok && local.value.status === 'CONFIGURATION_REQUIRED') ||
          (!local.ok && local.error.code === 'PIN_AUTH_ERROR');
        if (!needsRemoteBootstrap) {
          trackPreferenceIdentity(local);
          return local;
        }

        const remote = await bootstrapWithPin(pin);
        const result =
          !remote.ok && remote.error.code === 'REMOTE_SYNC_ERROR' && !local.ok
            ? local.error.code === 'PIN_AUTH_ERROR' && remote.error.message === 'Invalid PIN.'
              ? local
              : remote
            : remote;
        trackPreferenceIdentity(result);
        return result;
      };

      const getState = async (): Promise<OperationsSessionResult> => {
        const result = await session.getState();
        trackPreferenceIdentity(result);
        return result;
      };

      const signOut = async (): Promise<OperationsSessionResult> => {
        const result = await session.signOut();
        trackPreferenceIdentity(result);
        return result;
      };

      if (preferenceRetryStarted) trackPreferenceIdentity(await session.getState());

      return {
        session,
        workerUiPreferences,
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
        getState,
        submitPin,
        signOut,
      };
    })();
  }
  return browserRuntimePromise;
}

export function createOperationsSessionClient(): OperationsSessionClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.session;
  return {
    getState: async () => (await browserRuntime()).getState(),
    submitPin: async (pin: string) => (await browserRuntime()).submitPin(pin),
    signOut: async () => (await browserRuntime()).signOut(),
    enrollDevice: async (pin: string) => (await browserRuntime()).submitPin(pin),
  };
}

export function createWorkerUiPreferencesClient(): OperationsWorkerUiPreferencesClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.workerUiPreferences;
  return {
    load: async () => (await browserRuntime()).workerUiPreferences.load(),
    update: async (input) => (await browserRuntime()).workerUiPreferences.update(input),
    reset: async () => (await browserRuntime()).workerUiPreferences.reset(),
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
