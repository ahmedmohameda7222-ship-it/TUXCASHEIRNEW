import {
  ApplicationCommandCoordinator,
  InboundConfigurationSyncService,
  OperationsBusinessDayService,
  OperationsConfigurationSyncService,
  OperationsInventoryService,
  OperationsOrdersService,
  OperationsSessionService,
  OperationsSyncService,
  OperationsWorkerUiPreferencesService,
  OperationsOnlineOrderAcceptanceService,
  type AuthoritativeWorkerAuthenticationResult,
  type InboundConfigurationProvider,
  type OperationsConfigurationSyncState,
  type OperationsInventoryClient,
  type OperationsOrdersClient,
  type OperationsRemoteGateway,
  type OperationsSessionClient,
  type OperationsSyncClient,
  type OperationsWorkerUiPreferencesClient,
  type OperationsWorkerUiPreferencesSnapshot,
} from '@tux/application';
import { instant, parseEntityId, type ShopId, type WorkerId } from '@tux/domain';
import {
  createBrowserOperationsPersistence,
  IndexedDbOnlineOrderInboxStore,
  IndexedDbOrderDraftStore,
} from '@tux/persistence/browser';
import type { TuxDesktopApi } from '@tux/platform-contracts';
import { BrowserOnlineOrderOperationsRemote } from './onlineOrderInboxSync';
import { VercelBrowserRemoteGateway } from './browserRemote';
import { BrowserOperationsRemoteGateway } from './browserSyncRemote';
import { createBrowserPrinter } from './browserPrinter';

export interface OperationsConfigurationSyncClient {
  syncIfNeeded(): Promise<OperationsConfigurationSyncState>;
}

declare global {
  interface Window {
    tuxDesktop?: TuxDesktopApi;
  }
}

let runtimePromise: Promise<{
  session: OperationsSessionService;
  businessDay: OperationsBusinessDayService;
  configurationSync: OperationsConfigurationSyncService;
  orders: OperationsOrdersService;
  inventory: OperationsInventoryService;
  sync: OperationsSyncService;
  workerUiPreferences: OperationsWorkerUiPreferencesService;
}> | null = null;
let browserDataAdapterPromise: ReturnType<typeof createBrowserOperationsPersistence> | null = null;
let browserOnlineOrderInboxStorePromise: Promise<IndexedDbOnlineOrderInboxStore> | null = null;

function configuredRemoteGateway(): VercelBrowserRemoteGateway {
  return new VercelBrowserRemoteGateway();
}

async function browserDataAdapter() {
  if (browserDataAdapterPromise === null) {
    browserDataAdapterPromise = createBrowserOperationsPersistence();
  }
  return browserDataAdapterPromise;
}

export async function browserOnlineOrderInboxStore(): Promise<IndexedDbOnlineOrderInboxStore> {
  if (browserOnlineOrderInboxStorePromise === null) {
    browserOnlineOrderInboxStorePromise = (async () => {
      const store = new IndexedDbOnlineOrderInboxStore();
      await store.initialize();
      return store;
    })();
  }
  return browserOnlineOrderInboxStorePromise;
}

async function browserRuntime() {
  if (runtimePromise === null) {
    runtimePromise = (async () => {
      const persistence = await browserDataAdapter();
      const remote = configuredRemoteGateway();
      const coordinator = new ApplicationCommandCoordinator();
      const session = new OperationsSessionService(
        persistence.database,
        persistence.readModel,
        {
          now: () => instant(new Date()),
          createUuid: () => crypto.randomUUID(),
        },
        coordinator,
        remote,
      );
      const businessDay = new OperationsBusinessDayService(
        persistence.database,
        persistence.readModel,
        {
          now: () => instant(new Date()),
          createUuid: () => crypto.randomUUID(),
        },
        coordinator,
      );
      const inboundConfiguration = new InboundConfigurationSyncService(
        persistence.database,
        persistence.readModel,
        remote as InboundConfigurationProvider,
        () => instant(new Date()),
      );
      const configurationSync = new OperationsConfigurationSyncService(
        inboundConfiguration,
        persistence.readModel,
      );
      const draftStore = new IndexedDbOrderDraftStore();
      await draftStore.initialize();
      const orders = new OperationsOrdersService(
        persistence.database,
        persistence.readModel,
        draftStore,
        {
          now: () => instant(new Date()),
          createUuid: () => crypto.randomUUID(),
        },
        coordinator,
        createBrowserPrinter(),
      );
      const inventory = new OperationsInventoryService(
        persistence.database,
        persistence.readModel,
        {
          now: () => instant(new Date()),
          createUuid: () => crypto.randomUUID(),
        },
        coordinator,
      );
      const syncRemote: OperationsRemoteGateway = new BrowserOperationsRemoteGateway();
      const sync = new OperationsSyncService(
        persistence.outboxStore,
        persistence.syncStateStore,
        persistence.pullProjectionStore,
        persistence.appliedOperationStore,
        syncRemote,
        () => instant(new Date()),
      );
      const workerUiPreferences = new OperationsWorkerUiPreferencesService(
        persistence.workerUiPreferencesStore,
        remote,
        session,
        () => instant(new Date()),
      );
      return {
        session,
        businessDay,
        configurationSync,
        orders,
        inventory,
        sync,
        workerUiPreferences,
      };
    })();
  }
  return runtimePromise;
}

function browserSessionClient(): OperationsSessionClient {
  return {
    getState: async () => (await browserRuntime()).session.getState(),
    signInWithPin: async (pin) => (await browserRuntime()).session.signInWithPin(pin),
    signOut: async () => (await browserRuntime()).session.signOut(),
  };
}

function browserBusinessDayClient() {
  return {
    startBusinessDay: async (input: Parameters<OperationsBusinessDayService['startBusinessDay']>[0]) =>
      (await browserRuntime()).businessDay.startBusinessDay(input),
    endBusinessDay: async (input: Parameters<OperationsBusinessDayService['endBusinessDay']>[0]) =>
      (await browserRuntime()).businessDay.endBusinessDay(input),
  };
}

function browserConfigurationSyncClient(): OperationsConfigurationSyncClient {
  return {
    syncIfNeeded: async () => (await browserRuntime()).configurationSync.syncIfNeeded(),
  };
}

function browserOrdersClient(): OperationsOrdersClient {
  return {
    loadWorkspace: async (draftScopeId) => (await browserRuntime()).orders.loadWorkspace(draftScopeId),
    startOrderFromCustomerPrefill: async (input) =>
      (await browserRuntime()).orders.startOrderFromCustomerPrefill(input),
    restoreParkedDraft: async (input) => (await browserRuntime()).orders.restoreParkedDraft(input),
    discardParkedDraft: async (input) => (await browserRuntime()).orders.discardParkedDraft(input),
    saveDraft: async (draft) => (await browserRuntime()).orders.saveDraft(draft),
    findCustomerByPhone: async (shopId, normalizedPhone) =>
      (await browserRuntime()).orders.findCustomerByPhone(shopId, normalizedPhone),
    placeOrder: async (draft, placement) =>
      (await browserRuntime()).orders.placeOrder(draft, placement),
    reprintOrder: async (orderId) => (await browserRuntime()).orders.reprintOrder(orderId),
    parkCurrentOrder: async (draft) => (await browserRuntime()).orders.parkCurrentOrder(draft),
  };
}

function browserInventoryClient(): OperationsInventoryClient {
  return {
    loadSnapshot: async () => (await browserRuntime()).inventory.loadSnapshot(),
    applyManualAdjustment: async (input) =>
      (await browserRuntime()).inventory.applyManualAdjustment(input),
  };
}

function browserSyncClient(): OperationsSyncClient {
  return {
    syncNow: async () => (await browserRuntime()).sync.syncNow(),
    getStatus: async () => (await browserRuntime()).sync.getStatus(),
    subscribe: (listener) => {
      let active = true;
      let unsubscribe = (): void => undefined;
      void browserRuntime().then((runtime) => {
        if (!active) return;
        unsubscribe = runtime.sync.subscribe(listener);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}

function browserWorkerUiPreferencesClient(): OperationsWorkerUiPreferencesClient {
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

export function createOperationsSessionClient(): OperationsSessionClient {
  return window.tuxDesktop?.session ?? browserSessionClient();
}

export function createOperationsBusinessDayClient() {
  return window.tuxDesktop?.businessDay ?? browserBusinessDayClient();
}

export function createOperationsConfigurationSyncClient(): OperationsConfigurationSyncClient {
  return window.tuxDesktop?.configurationSync ?? browserConfigurationSyncClient();
}

export function createOperationsWorkerUiPreferencesClient(): OperationsWorkerUiPreferencesClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.workerUiPreferences;
  return browserWorkerUiPreferencesClient();
}

export function createOperationsOnlineOrderAcceptanceClient(): Pick<
  OperationsOnlineOrderAcceptanceService,
  'accept'
> {
  const desktop = window.tuxDesktop?.onlineOrders;
  if (desktop !== undefined) {
    return {
      accept: (request, confirmation) => desktop.accept(request.requestId, confirmation),
    };
  }
  return {
    accept: async (request, confirmation) => {
      const runtime = await browserRuntime();
      return new OperationsOnlineOrderAcceptanceService(runtime.orders, {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      }).accept(request, confirmation);
    },
  };
}

export function createOperationsOrdersClient(): OperationsOrdersClient {
  return window.tuxDesktop?.orders ?? browserOrdersClient();
}

export function createOperationsInventoryClient(): OperationsInventoryClient {
  return window.tuxDesktop?.inventory ?? browserInventoryClient();
}

export function createOperationsSyncClient(): OperationsSyncClient {
  return window.tuxDesktop?.sync ?? browserSyncClient();
}

export async function authenticateOperationsWorker(
  pin: string,
): Promise<AuthoritativeWorkerAuthenticationResult> {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.session.authenticateWorker(pin);
  return configuredRemoteGateway().authenticateWorker(pin);
}

export async function currentOperationsShopId(): Promise<ShopId | null> {
  const state = await createOperationsSessionClient().getState();
  if (!state.ok || state.value.status === 'CONFIGURATION_REQUIRED') return null;
  return state.value.shopId;
}

export async function currentOperationsWorkerId(): Promise<WorkerId | null> {
  const state = await createOperationsSessionClient().getState();
  if (!state.ok || state.value.status !== 'ACTIVE') return null;
  return state.value.operator.id;
}

export async function loadWorkerUiPreferencesSnapshot(): Promise<OperationsWorkerUiPreferencesSnapshot> {
  return createOperationsWorkerUiPreferencesClient().load();
}

export function createBrowserOnlineOrderOperationsRemote(): BrowserOnlineOrderOperationsRemote {
  return new BrowserOnlineOrderOperationsRemote();
}
