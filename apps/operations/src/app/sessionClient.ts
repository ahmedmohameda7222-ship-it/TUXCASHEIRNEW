import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsBulkStockService,
  OperationsConfigurationSyncService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOrdersBoardService,
  OperationsOrdersService,
  OperationsWhatsAppService,
  OperationsWorkerAuthenticationService,
  WorkerMenuLayoutRetryController,
  WorkerMenuLayoutService,
  WorkerUiPreferencesRetryController,
  WorkerUiPreferencesService,
  err,
  workerMenuLayoutUpdateFromFlatProductOrder,
  type OperationsSessionResult,
  type WorkerCredentialStore,
  type WorkerMenuLayoutSyncIdentity,
  type WorkerUiPreferencesSyncIdentity,
} from '@tux/application';
import {
  flattenWorkerMenuLayoutProductOrder,
  instant,
  parseWorkerUiPreferences,
  type ShopId,
  type WorkerMenuLayout,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { OperationsDatabase, WorkerUiPreferencesRepository } from '@tux/persistence';
import {
  IndexedDbBulkStockStore,
  IndexedDbExpenseLedgerStore,
  IndexedDbOperationsDatabase,
  IndexedDbOperatorSessionReadModel,
  IndexedDbOrderDraftStore,
  IndexedDbWhatsAppStore,
  IndexedDbWorkerMenuLayoutStore,
} from '@tux/persistence/browser';
import type {
  TuxBulkStockApi,
  TuxEndDayApi,
  TuxExpensesApi,
  TuxOrdersApi,
  TuxOrdersBoardApi,
  TuxWhatsAppApi,
  TuxWorkerMenuLayoutApi,
  TuxWorkerUiPreferencesApi,
} from '@tux/platform-contracts';
import { startBrowserAutomaticSync } from './automaticSync';
import { VercelBrowserRemoteGateway } from './browserRemote';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  enrollDevice?(pin: string): Promise<OperationsSessionResult>;
}

export type OperationsWorkerMenuLayoutClient = TuxWorkerMenuLayoutApi;
export type OperationsWorkerUiPreferencesClient = TuxWorkerUiPreferencesApi;
export type OperationsOrdersClient = TuxOrdersApi;
export type OperationsOrdersBoardClient = TuxOrdersBoardApi;
export type OperationsExpensesClient = TuxExpensesApi;
export type OperationsBulkStockClient = TuxBulkStockApi;
export type OperationsEndDayClient = TuxEndDayApi;
export type OperationsWhatsAppClient = TuxWhatsAppApi;

interface BrowserRuntime {
  readonly database: OperationsDatabase;
  readonly session: CoordinatedOperationsSessionService;
  readonly workerMenuLayout: TuxWorkerMenuLayoutApi;
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
let browserWhatsAppPromise: Promise<TuxWhatsAppApi> | null = null;

async function browserWhatsAppRuntime(): Promise<TuxWhatsAppApi> {
  if (browserWhatsAppPromise === null) {
    browserWhatsAppPromise = (async () => {
      const store = new IndexedDbWhatsAppStore('tux-operations-v2');
      await store.initialize();
      const database: OperationsDatabase = {
        transaction: async (work) => (await browserRuntime()).database.transaction(work),
      };
      return new OperationsWhatsAppService(
        new VercelBrowserWhatsAppRemote(),
        store,
        { getState: async () => (await browserRuntime()).getState() },
        () => instant(new Date()),
        database,
      );
    })();
  }
  return browserWhatsAppPromise;
}

async function browserRuntime(): Promise<BrowserRuntime> {
  if (browserRuntimePromise === null) {
    browserRuntimePromise = (async () => {
      const database = new IndexedDbOperationsDatabase();
      await database.initialize();
      const menuLayoutStore = new IndexedDbWorkerMenuLayoutStore();
      await menuLayoutStore.initialize();
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
      const menuLayoutService = new WorkerMenuLayoutService(
        menuLayoutStore,
        remoteGateway,
        { getWorkerMenuLayoutCatalog: (shopId) => menuLayoutStore.getCatalog(shopId) },
        runtime.now,
      );

      let activePreferenceIdentity: WorkerUiPreferencesSyncIdentity | null = null;
      let activeMenuLayoutIdentity: WorkerMenuLayoutSyncIdentity | null = null;
      const preferencesRetry = new WorkerUiPreferencesRetryController(
        preferencesService,
        () => activePreferenceIdentity,
      );
      const menuLayoutRetry = new WorkerMenuLayoutRetryController(
        menuLayoutService,
        () => activeMenuLayoutIdentity,
      );
      let automaticSyncStarted = false;
      let configurationTimerStarted = false;
      let preferenceRetryStarted = false;
      let menuLayoutRetryStarted = false;

      const retryPreferences = (): void => {
        void preferencesRetry.syncActive();
      };
      const retryMenuLayout = (): void => {
        void menuLayoutRetry.syncActive();
      };
      const retryWorkerState = (): void => {
        retryPreferences();
        retryMenuLayout();
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
          preferenceRetryStarted = true;
        }
        if (!menuLayoutRetryStarted) {
          menuLayoutRetry.start();
          menuLayoutRetryStarted = true;
        }
        if (preferenceRetryStarted && menuLayoutRetryStarted) {
          window.removeEventListener('online', retryWorkerState);
          window.addEventListener('online', retryWorkerState);
        }
      };

      const trackWorkerIdentity = (result: OperationsSessionResult): void => {
        if (!result.ok || result.value.status !== 'ACTIVE') {
          activePreferenceIdentity = null;
          activeMenuLayoutIdentity = null;
          return;
        }
        const identity = {
          shopId: result.value.shopId,
          workerId: result.value.operator.id,
        };
        activePreferenceIdentity = identity;
        activeMenuLayoutIdentity = identity;
        if (preferenceRetryStarted) retryPreferences();
        if (menuLayoutRetryStarted) retryMenuLayout();
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

      const pinVerifier = new BrowserPbkdf2PinVerifier();
      const session = new CoordinatedOperationsSessionService(
        database,
        readModel,
        pinVerifier,
        runtime,
        coordinator,
      );
      const workerCredentialStore: WorkerCredentialStore = {
        put: (worker) => database.transaction((transaction) => transaction.workers.put(worker)),
        fenceMatchingPin: async (pin) => {
          const state = await session.getState();
          if (!state.ok || state.value.status === 'CONFIGURATION_REQUIRED') return;
          const workers = await readModel.listActiveWorkers(state.value.shopId);
          const matches: Array<(typeof workers)[number]> = [];
          for (const worker of workers) {
            if (await pinVerifier.verify(pin, worker.pinHash)) matches.push(worker);
          }
          if (matches.length === 0) return;
          await database.transaction(async (transaction) => {
            for (const worker of matches) {
              await transaction.workers.put({ ...worker, active: false });
            }
          });
        },
      };

      const activeIdentityFromSession = async (): Promise<WorkerMenuLayoutSyncIdentity> => {
        const result = await session.getState();
        if (!result.ok || result.value.status !== 'ACTIVE') {
          throw new Error('Active worker session required.');
        }
        return {
          shopId: result.value.shopId,
          workerId: result.value.operator.id,
        };
      };

      const compatiblePreferences = async (
        identity: WorkerMenuLayoutSyncIdentity,
        menuLayout?: WorkerMenuLayout | null,
        legacyPreferences?: WorkerUiPreferences | null,
      ): Promise<WorkerUiPreferences | null> => {
        const legacy =
          legacyPreferences === undefined
            ? await preferencesRepository.get(identity.shopId, identity.workerId)
            : legacyPreferences;
        const layout =
          menuLayout === undefined
            ? await menuLayoutStore.get(identity.shopId, identity.workerId)
            : menuLayout;
        if (legacy === null && layout === null) return null;
        return parseWorkerUiPreferences({
          shopId: identity.shopId,
          workerId: identity.workerId,
          categoryOrder: layout?.categoryOrder ?? legacy?.categoryOrder ?? [],
          categoryAlignment: layout?.categoryAlignment ?? legacy?.categoryAlignment ?? 'left',
          productOrder:
            layout === null || layout === undefined
              ? (legacy?.productOrder ?? [])
              : flattenWorkerMenuLayoutProductOrder(layout),
          accentColor: legacy?.accentColor ?? null,
          updatedAt: layout?.updatedAt ?? legacy?.updatedAt ?? runtime.now(),
          serverVersion: legacy?.serverVersion ?? 0,
          syncState: layout?.syncState ?? legacy?.syncState ?? 'CLEAN',
        });
      };

      const workerMenuLayout: TuxWorkerMenuLayoutApi = {
        load: async () => {
          const identity = await activeIdentityFromSession();
          return menuLayoutService.load(identity.shopId, identity.workerId);
        },
        subscribe: (listener) => menuLayoutService.subscribe(listener),
        updateMenuLayout: async (input) => {
          const identity = await activeIdentityFromSession();
          return menuLayoutService.updateMenuLayout(identity.shopId, identity.workerId, input);
        },
        resetMenuLayout: async () => {
          const identity = await activeIdentityFromSession();
          await menuLayoutService.resetMenuLayout(identity.shopId, identity.workerId);
        },
      };

      const workerUiPreferences: TuxWorkerUiPreferencesApi = {
        load: async () => {
          const identity = await activeIdentityFromSession();
          const layout = await menuLayoutService
            .load(identity.shopId, identity.workerId)
            .catch(() => menuLayoutStore.get(identity.shopId, identity.workerId));
          return compatiblePreferences(identity, layout);
        },
        subscribe: (listener) => {
          let active = true;
          const publishCurrent = async (): Promise<void> => {
            try {
              const identity = await activeIdentityFromSession();
              const preferences = await compatiblePreferences(identity);
              if (active && preferences !== null) listener(preferences);
            } catch {
              // Worker/session transitions intentionally fence stale preference notifications.
            }
          };
          const unsubscribePreferences = preferencesService.subscribe(() => void publishCurrent());
          const unsubscribeLayout = menuLayoutService.subscribe(() => void publishCurrent());
          return () => {
            active = false;
            unsubscribePreferences();
            unsubscribeLayout();
          };
        },
        updateMenuLayout: async (input) => {
          const identity = await activeIdentityFromSession();
          const isReset =
            input.categoryOrder.length === 0 &&
            input.productOrder.length === 0 &&
            input.categoryAlignment === 'left';
          const layout = isReset
            ? await menuLayoutService.resetMenuLayout(identity.shopId, identity.workerId)
            : await menuLayoutService.updateMenuLayout(
                identity.shopId,
                identity.workerId,
                workerMenuLayoutUpdateFromFlatProductOrder({
                  categoryOrder: input.categoryOrder,
                  categoryAlignment: input.categoryAlignment,
                  productOrder: input.productOrder,
                  catalog: await menuLayoutStore.getCatalog(identity.shopId),
                }),
              );
          return (await compatiblePreferences(identity, layout))!;
        },
        updateAccentColor: async (accentColor) => {
          const identity = await activeIdentityFromSession();
          const updated = await preferencesService.updateAccentColor(
            identity.shopId,
            identity.workerId,
            accentColor,
          );
          if (preferenceRetryStarted) retryPreferences();
          return (await compatiblePreferences(identity, undefined, updated))!;
        },
        resetMenuLayout: async () => {
          const identity = await activeIdentityFromSession();
          await menuLayoutService.resetMenuLayout(identity.shopId, identity.workerId);
        },
      };

      const bootstrapWithPin = async (pin: string): Promise<OperationsSessionResult> => {
        try {
          const bootstrap = await remoteGateway.bootstrap(pin);
          const configuration = await configurationService.sync(bootstrap.shopId);
          if (
            configuration.status === 'REMOTE_UNAVAILABLE' ||
            (configuration.status === 'UP_TO_DATE' && configuration.version === null)
          ) {
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
          await database.transaction(async (transaction) => {
            await transaction.shops.put(bootstrap.shop);
            await transaction.workers.put(bootstrap.worker);
          });
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
        const state = await session.getState();
        if (!state.ok) {
          trackWorkerIdentity(state);
          return state;
        }
        if (state.value.status === 'CONFIGURATION_REQUIRED') {
          const result = await bootstrapWithPin(pin);
          trackWorkerIdentity(result);
          return result;
        }

        const workerAuthentication = new OperationsWorkerAuthenticationService(
          session,
          { authenticate: () => remoteGateway.authenticateWorker(pin) },
          workerCredentialStore,
        );
        const result = await workerAuthentication.submitPin(pin);
        trackWorkerIdentity(result);
        return result;
      };

      const getState = async (): Promise<OperationsSessionResult> => {
        const result = await session.getState();
        trackWorkerIdentity(result);
        return result;
      };

      const signOut = async (): Promise<OperationsSessionResult> => {
        const result = await session.signOut();
        trackWorkerIdentity(result);
        return result;
      };

      if (preferenceRetryStarted || menuLayoutRetryStarted) {
        trackWorkerIdentity(await session.getState());
      }

      return {
        database,
        session,
        workerMenuLayout,
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

export function createOperationsWhatsAppClient(): OperationsWhatsAppClient {
  const desktop = window.tuxDesktop?.whatsapp;
  if (desktop !== undefined) return desktop;
  return {
    loadInbox: async (cursor) => (await browserWhatsAppRuntime()).loadInbox(cursor),
    loadConversation: async (conversationId) =>
      (await browserWhatsAppRuntime()).loadConversation(conversationId),
    resolveMessagingTarget: async (input) =>
      (await browserWhatsAppRuntime()).resolveMessagingTarget(input),
    sendTemplate: async (input) => (await browserWhatsAppRuntime()).sendTemplate(input),
    sendText: async (input) => (await browserWhatsAppRuntime()).sendText(input),
    sendMedia: async (input) => (await browserWhatsAppRuntime()).sendMedia(input),
    sendLocation: async (input) => (await browserWhatsAppRuntime()).sendLocation(input),
    retryFailedMessage: async (input) => (await browserWhatsAppRuntime()).retryFailedMessage(input),
    getMediaAccess: async (messageId) => (await browserWhatsAppRuntime()).getMediaAccess(messageId),
    markUnread: async (conversationId) =>
      (await browserWhatsAppRuntime()).markUnread(conversationId),
    archive: async (conversationId, archived) =>
      (await browserWhatsAppRuntime()).archive(conversationId, archived),
    setFollowUp: async (conversationId, followUp) =>
      (await browserWhatsAppRuntime()).setFollowUp(conversationId, followUp),
    linkOrder: async (input) => (await browserWhatsAppRuntime()).linkOrder(input),
    saveDraft: async (conversationId, text) =>
      (await browserWhatsAppRuntime()).saveDraft(conversationId, text),
    getDraft: async (conversationId) => (await browserWhatsAppRuntime()).getDraft(conversationId),
    resolveCustomerOrderContext: async (conversationId) =>
      (await browserWhatsAppRuntime()).resolveCustomerOrderContext(conversationId),
  };
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

export function createWorkerMenuLayoutClient(): OperationsWorkerMenuLayoutClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.workerMenuLayout;
  return {
    load: async () => (await browserRuntime()).workerMenuLayout.load(),
    subscribe: (listener) => {
      let active = true;
      let unsubscribe = (): void => undefined;
      void browserRuntime().then((runtime) => {
        if (!active) return;
        unsubscribe = runtime.workerMenuLayout.subscribe(listener);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
    updateMenuLayout: async (input) =>
      (await browserRuntime()).workerMenuLayout.updateMenuLayout(input),
    resetMenuLayout: async () => (await browserRuntime()).workerMenuLayout.resetMenuLayout(),
  };
}

export function createWorkerUiPreferencesClient(): OperationsWorkerUiPreferencesClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.workerUiPreferences;
  return {
    load: async () => (await browserRuntime()).workerUiPreferences.load(),
    subscribe: (listener) => {
      let active = true;
      let unsubscribe = (): void => undefined;
      void browserRuntime().then((runtime) => {
        if (!active) return;
        unsubscribe = runtime.workerUiPreferences.subscribe(listener);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
    updateMenuLayout: async (input) =>
      (await browserRuntime()).workerUiPreferences.updateMenuLayout(input),
    updateAccentColor: async (accentColor) =>
      (await browserRuntime()).workerUiPreferences.updateAccentColor(accentColor),
    resetMenuLayout: async () => (await browserRuntime()).workerUiPreferences.resetMenuLayout(),
  };
}

export function createOperationsOrdersClient(): OperationsOrdersClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.orders;
  return {
    loadWorkspace: async (draftScopeId) =>
      (await browserRuntime()).orders.loadWorkspace(draftScopeId),
    startOrderFromCustomerPrefill: async (input) =>
      (await browserRuntime()).orders.startOrderFromCustomerPrefill(input),
    restoreParkedDraft: async (input) => (await browserRuntime()).orders.restoreParkedDraft(input),
    discardParkedDraft: async (input) => (await browserRuntime()).orders.discardParkedDraft(input),
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
