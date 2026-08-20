import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsBulkStockService,
  OperationsConfigurationSyncService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  type OperationsSessionResult,
} from '@tux/application';
import { instant } from '@tux/domain';
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
import {
  SupabaseDeviceSessionManager,
  SupabaseInboundConfigurationProvider,
  SupabaseOperationsBootstrapProvider,
  type AutomaticOutboxScheduler,
} from '@tux/sync';
import { startBrowserAutomaticSync } from './automaticSync';
import {
  BrowserIndexedDbDeviceSessionStore,
  browserRemoteSetupDefaults,
  loadBrowserRemoteSettings,
  saveBrowserRemoteSettings,
  type BrowserRemoteSettings,
  type BrowserRemoteSetupDefaults,
  type BrowserRemoteSetupInput,
} from './browserRemote';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  readonly remoteSetupDefaults?: BrowserRemoteSetupDefaults;
  setupRemoteDevice?(input: BrowserRemoteSetupInput): Promise<OperationsSessionResult>;
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
  readonly remoteSetupDefaults: BrowserRemoteSetupDefaults;
  setupRemoteDevice(input: BrowserRemoteSetupInput): Promise<OperationsSessionResult>;
}

let browserRuntimePromise: Promise<BrowserRuntime> | null = null;

function remoteSyncError(message: string, cause: unknown): OperationsSessionResult {
  return {
    ok: false,
    error: {
      code: 'REMOTE_SYNC_ERROR',
      message,
      cause,
    },
  };
}

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
      const session = new CoordinatedOperationsSessionService(
        database,
        readModel,
        new BrowserPbkdf2PinVerifier(),
        runtime,
        coordinator,
      );
      const orders = new OperationsOrdersService(
        database,
        readModel,
        draftStore,
        runtime,
        coordinator,
        new BrowserOrderPrinter(),
      );
      const ordersBoard = new OperationsOrdersBoardService(database, readModel, runtime, coordinator);
      const expenses = new OperationsExpensesService(
        database,
        readModel,
        expenseStore,
        runtime,
        coordinator,
      );
      const bulkStock = new OperationsBulkStockService(
        database,
        readModel,
        bulkStockStore,
        runtime,
        coordinator,
      );
      const endDay = new OperationsEndDayService(
        database,
        readModel,
        draftStore,
        expenseStore,
        runtime,
        coordinator,
      );

      let automaticSyncScheduler: AutomaticOutboxScheduler | null = null;
      let configurationRefreshTimer: number | null = null;

      const createSessionManager = (settings: BrowserRemoteSettings) =>
        new SupabaseDeviceSessionManager({
          projectUrl: settings.projectUrl,
          publishableKey: settings.publishableKey,
          store: new BrowserIndexedDbDeviceSessionStore(),
        });

      const synchronizeRemote = async (
        settings: BrowserRemoteSettings,
        manager: SupabaseDeviceSessionManager,
        requireRemoteSuccess: boolean,
      ): Promise<void> => {
        const remoteSession = await manager.requiredSession();
        const bootstrap = await new SupabaseOperationsBootstrapProvider({
          projectUrl: settings.projectUrl,
          session: manager,
        }).fetch(remoteSession.shopId);
        const existingActiveWorkers = await readModel.listActiveWorkers(remoteSession.shopId);
        const remoteWorkerIds = new Set(bootstrap.workers.map((worker) => worker.id));
        await database.transaction(async (transaction) => {
          await transaction.shops.put(bootstrap.shop);
          await transaction.devices.put(bootstrap.device);
          for (const worker of existingActiveWorkers) {
            if (!remoteWorkerIds.has(worker.id)) {
              await transaction.workers.put({ ...worker, active: false });
            }
          }
          for (const worker of bootstrap.workers) {
            await transaction.workers.put(worker);
          }
        });

        const configurationService = new OperationsConfigurationSyncService(
          database,
          coordinator,
          new SupabaseInboundConfigurationProvider({
            projectUrl: settings.projectUrl,
            session: manager,
          }),
        );
        const configurationResult = await configurationService.sync(remoteSession.shopId);
        if (
          configurationResult.status === 'INVALID_REMOTE_CONFIGURATION' ||
          configurationResult.status === 'LOCAL_PERSISTENCE_ERROR'
        ) {
          throw new Error(configurationResult.message);
        }
        if (requireRemoteSuccess && configurationResult.status === 'REMOTE_UNAVAILABLE') {
          throw new Error('The remote Operations configuration is currently unavailable.');
        }
      };

      const startRemoteBackground = (
        settings: BrowserRemoteSettings,
        manager: SupabaseDeviceSessionManager,
      ): void => {
        automaticSyncScheduler?.stop();
        automaticSyncScheduler = startBrowserAutomaticSync({
          database,
          now: runtime.now,
          projectUrl: settings.projectUrl,
          sessionManager: manager,
        });
        if (configurationRefreshTimer !== null) window.clearInterval(configurationRefreshTimer);
        configurationRefreshTimer = window.setInterval(() => {
          void synchronizeRemote(settings, manager, false).catch((cause) => {
            console.warn(
              'TUX browser remote refresh is unavailable; continuing with last known-good local data.',
              cause,
            );
          });
        }, 5 * 60 * 1000);
      };

      const setupRemoteDevice = async (
        input: BrowserRemoteSetupInput,
      ): Promise<OperationsSessionResult> => {
        const settings: BrowserRemoteSettings = {
          projectUrl: input.projectUrl.trim(),
          publishableKey: input.publishableKey.trim(),
        };
        try {
          const manager = createSessionManager(settings);
          await manager.enroll({
            enrollmentCode: input.enrollmentCode.trim(),
            deviceId: crypto.randomUUID(),
            deviceLabel: input.deviceLabel.trim() || 'Browser POS',
          });
          saveBrowserRemoteSettings(settings);
          await synchronizeRemote(settings, manager, true);
          startRemoteBackground(settings, manager);
          return session.getState();
        } catch (cause) {
          return remoteSyncError(
            cause instanceof Error
              ? `Device setup failed: ${cause.message}`
              : 'Device setup failed. Check the Supabase settings and enrollment code.',
            cause,
          );
        }
      };

      const savedSettings = loadBrowserRemoteSettings();
      if (savedSettings !== null) {
        const manager = createSessionManager(savedSettings);
        try {
          const existingSession = await manager.currentSession();
          if (existingSession !== null) {
            try {
              await synchronizeRemote(savedSettings, manager, false);
            } catch (cause) {
              console.warn(
                'TUX browser remote bootstrap is unavailable; continuing with last known-good local data.',
                cause,
              );
            }
            startRemoteBackground(savedSettings, manager);
          }
        } catch (cause) {
          console.warn('TUX browser device session could not be restored.', cause);
        }
      }

      return {
        session,
        orders,
        ordersBoard,
        expenses,
        bulkStock,
        endDay,
        remoteSetupDefaults: browserRemoteSetupDefaults(),
        setupRemoteDevice,
      };
    })();
  }
  return browserRuntimePromise;
}

export function createOperationsSessionClient(): OperationsSessionClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.session;
  const defaults = browserRemoteSetupDefaults();
  return {
    remoteSetupDefaults: defaults,
    getState: async () => (await browserRuntime()).session.getState(),
    submitPin: async (pin: string) => (await browserRuntime()).session.submitPin(pin),
    signOut: async () => (await browserRuntime()).session.signOut(),
    setupRemoteDevice: async (input) => (await browserRuntime()).setupRemoteDevice(input),
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
