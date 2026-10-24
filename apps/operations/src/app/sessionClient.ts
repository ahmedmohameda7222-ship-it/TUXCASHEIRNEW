import {
  ApplicationCommandCoordinator,
  CoordinatedOperationsSessionService,
  OperationsBulkStockService,
  OperationsConfigurationSyncService,
  OperationsEndDayService,
  OperationsExpensesService,
  OperationsOnlineOrderAcceptanceService,
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
  parseEntityId,
  parseWorkerUiPreferences,
  type BusinessDayId,
  type ShopId,
  type WorkerMenuLayout,
  type WorkerUiPreferences,
} from '@tux/domain';
import type { OperationsDatabase, WorkerUiPreferencesRepository } from '@tux/persistence';
import { HttpOutboxTransport, OutboxSyncService } from '@tux/sync';
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
import { recoverMissingBusinessDayStart } from './businessDayStartRecovery';
import {
  assertCanonicalDayNotLocallyClosed,
  reconcileCanonicalBusinessDay,
} from './businessDayPreflight';
import { VercelBrowserRemoteGateway, WorkerSessionLeaseLostError } from './browserRemote';
import { selectBrowserShop } from './browserShopScope';
import { fenceStaleBrowserSession } from './browserSessionScope';
import { BrowserOrderPrinter } from './browserOrderPrinter';
import { BrowserOrderRewardAuthority } from './browserOrderRewards';
import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string, shopId?: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  shouldCloseDayOnSignOut?(): Promise<boolean>;
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
  submitPin(pin: string, shopId?: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
  shouldCloseDayOnSignOut(): Promise<boolean>;
}

// Only the intentionally named E2E fixture build running on loopback can
// exercise legacy IndexedDB worker credentials without the server BFF.
// Production, staging and authenticated branch-picker E2E retain the full
// server-verified cookie + worker authentication boundary.
const LEGACY_BROWSER_E2E =
  import.meta.env.MODE === 'e2e-browser-fallback' &&
  typeof window !== 'undefined' &&
  (window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.localhost'));

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
      const rewardAuthority = new BrowserOrderRewardAuthority();

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
      let activeSyncShopId: ShopId | null = null;
      let automaticSyncHandle: ReturnType<typeof startBrowserAutomaticSync> | null = null;
      let configurationTimer: number | null = null;
      let sessionLeaseTimer: number | null = null;
      let sessionLeaseHeartbeat: (() => Promise<void>) | null = null;
      let preferenceRetryStarted = false;
      let menuLayoutRetryStarted = false;

      const retryPreferences = (): void => {
        void preferencesRetry.syncActive();
      };

      // The reserved .localhost fixture exercises the actual preference
      // subscription without enabling outbox, inventory or shop configuration
      // polling. Production and the authenticated Branch + PIN E2E never enter
      // this branch.
      const startLegacyRemotePreferenceFixture = (): void => {
        if (!LEGACY_BROWSER_E2E || !window.location.hostname.endsWith('.localhost')) return;
        if (!preferenceRetryStarted) {
          preferencesRetry.start();
          preferenceRetryStarted = true;
          window.addEventListener('online', retryPreferences);
        }
        retryPreferences();
      };
      const retryMenuLayout = (): void => {
        void menuLayoutRetry.syncActive();
      };
      const retryWorkerState = (): void => {
        retryPreferences();
        retryMenuLayout();
      };

      const stopRemoteRuntime = (): void => {
        automaticSyncHandle?.stop();
        automaticSyncHandle = null;
        if (configurationTimer !== null) {
          window.clearInterval(configurationTimer);
          configurationTimer = null;
        }
        if (sessionLeaseTimer !== null) {
          window.clearInterval(sessionLeaseTimer);
          sessionLeaseTimer = null;
        }
        window.removeEventListener('focus', refreshSessionLease);
        window.removeEventListener('online', refreshSessionLease);
        document.removeEventListener('visibilitychange', refreshVisibleSessionLease);
        sessionLeaseHeartbeat = null;
        activeSyncShopId = null;
      };

      const refreshSessionLease = (): void => {
        void sessionLeaseHeartbeat?.();
      };

      const refreshVisibleSessionLease = (): void => {
        if (document.visibilityState === 'visible') refreshSessionLease();
      };

      const startRemoteRuntime = (shopId: ShopId): void => {
        // A browser can change branches after signing out. Never leave Shop A's
        // outbox, inventory or configuration polls active under Shop B's cookie.
        if (activeSyncShopId !== shopId) {
          stopRemoteRuntime();
          automaticSyncHandle = startBrowserAutomaticSync({
            database,
            now: runtime.now,
            shopId,
            rewardClaims: rewardAuthority,
          });
          configurationTimer = window.setInterval(
            () => void configurationService.sync(shopId),
            5 * 60 * 1000,
          );
          const heartbeat = async (): Promise<void> => {
            try {
              const day = await database.transaction((tx) =>
                tx.businessDays.getOpenForShop(shopId),
              );
              if (day?.status !== 'OPEN') return;
              const workerSession = await readModel.getOpenWorkerSession(day.id);
              if (workerSession === null) return;
              await remoteGateway.touchWorkerSession(day.id, workerSession.id);
            } catch (cause) {
              if (cause instanceof WorkerSessionLeaseLostError) {
                // Canonical authority has explicitly ended this session. Fence
                // the local client immediately so it cannot resume split-brain.
                await session.signOut();
                stopRemoteRuntime();
                activePreferenceIdentity = null;
                activeMenuLayoutIdentity = null;
              }
              // Transient network/server failures keep local state durable; a
              // later heartbeat or event delivery retries them.
            }
          };
          sessionLeaseHeartbeat = heartbeat;
          void heartbeat();
          sessionLeaseTimer = window.setInterval(() => void heartbeat(), 60 * 1000);
          window.addEventListener('focus', refreshSessionLease);
          window.addEventListener('online', refreshSessionLease);
          document.addEventListener('visibilitychange', refreshVisibleSessionLease);
          activeSyncShopId = shopId;
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

      let recoveredShopId: ShopId | null = null;
      try {
        const remoteSession = await remoteGateway.currentSession();
        if (remoteSession !== null) {
          await configurationService.sync(remoteSession.shopId);
          recoveredShopId = remoteSession.shopId;
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
      // Do not start background syncing the previously selected shop on a signed-out
      // browser. The next PIN login may choose a different branch.
      if (recoveredShopId !== null) {
        const recovered = await session.getState();
        if (
          recovered.ok &&
          recovered.value.status === 'ACTIVE' &&
          recovered.value.shopId === recoveredShopId
        ) {
          startRemoteRuntime(recoveredShopId);
        }
      }
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

      const flushShopOutbox = async (shopId: ShopId): Promise<void> => {
        const endpoint = new URL('/api/operations-sync', window.location.origin).toString();
        const service = new OutboxSyncService(
          database,
          new HttpOutboxTransport({
            endpoint,
            onDependencyMissing: async (event, missingDayId) => {
              await recoverMissingBusinessDayStart({
                database,
                businessDayId: parseEntityId<BusinessDayId>(missingDayId),
                shopId: event.shopId,
                createUuid: runtime.createUuid,
              });
            },
          }),
          { now: runtime.now },
          shopId,
        );
        for (let batch = 0; batch < 4; batch += 1) {
          const result = await service.syncOnce(50);
          if (result.failed > 0 || result.delivered < 50) break;
        }
      };

      const checkDayBeforeLogin = async (shopId: ShopId): Promise<void> => {
        await reconcileCanonicalBusinessDay({
          shopId,
          drainLocalOutbox: () => flushShopOutbox(shopId),
          getLocalOpenDay: async () => {
            const day = await database.transaction((tx) => tx.businessDays.getOpenForShop(shopId));
            return day?.status === 'OPEN' ? day : null;
          },
          getCanonicalState: (scope, localDayId) =>
            remoteGateway.readCanonicalOpenBusinessDay(scope, localDayId),
          adoptCanonicalDay: async (canonical, oldLocal) => {
            const previousSession =
              oldLocal === null ? null : await readModel.getOpenWorkerSession(oldLocal.id);
            await database.transaction(async (tx) => {
              const current = await tx.businessDays.getOpenForShop(shopId);
              if (canonical !== null) {
                assertCanonicalDayNotLocallyClosed(await tx.businessDays.getById(canonical.id));
              }
              if ((current?.id ?? null) !== (oldLocal?.id ?? null)) {
                throw new Error('Local Business Day changed during canonical recovery.');
              }
              if (oldLocal !== null && (canonical === null || oldLocal.id !== canonical.id)) {
                const closedAt = instant(
                  new Date(Math.max(Date.parse(oldLocal.startedAt), Date.now())),
                );
                // Mock-only mismatch: preserve every old event as quarantined,
                // never erase local storage or manufacture a remote End Day.
                const pending = await tx.outbox.listPending(
                  instant('9999-12-31T23:59:59Z'),
                  100000,
                  shopId,
                );
                for (const event of pending) {
                  if (event.businessDayId === oldLocal.id) {
                    await tx.outbox.quarantine(
                      event.id,
                      closedAt,
                      'DEVELOPMENT_CANONICAL_DAY_RECOVERY',
                    );
                  }
                }
                if (previousSession?.endedAt === null) {
                  await tx.workerSessions.put({ ...previousSession, endedAt: closedAt });
                }
                await tx.businessDays.put({
                  ...oldLocal,
                  status: 'CLOSED',
                  endedAt: closedAt,
                  endedByWorkerId: oldLocal.startedByWorkerId,
                });
              }
              if (canonical !== null) {
                await tx.businessDays.put({
                  ...canonical,
                  lastAllocatedDisplayOrderNo: Math.max(
                    canonical.lastAllocatedDisplayOrderNo,
                    current?.id === canonical.id ? current.lastAllocatedDisplayOrderNo : 0,
                  ),
                });
              }
            });
          },
        });
      };

      const bootstrapWithPin = async (
        pin: string,
        shopId?: string,
      ): Promise<OperationsSessionResult> => {
        try {
          const bootstrap = await remoteGateway.bootstrap(pin, shopId);
          if (activeSyncShopId !== bootstrap.shopId) stopRemoteRuntime();
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
          await selectBrowserShop(database, readModel, bootstrap.shop, bootstrap.worker);
          await checkDayBeforeLogin(bootstrap.shopId);
          const signedIn = await session.submitPin(pin);
          // The remote cookie and the local PIN result must both be valid before
          // background sync is permitted to run under this shop.
          if (signedIn.ok && signedIn.value.status === 'ACTIVE') {
            startRemoteRuntime(signedIn.value.shopId);
          }
          return signedIn;
        } catch (cause) {
          return err({
            code: 'REMOTE_SYNC_ERROR',
            message:
              cause instanceof Error ? cause.message : 'Could not sign in to TUX Operations.',
            cause,
          });
        }
      };

      const submitPin = async (pin: string, shopId?: string): Promise<OperationsSessionResult> => {
        if (LEGACY_BROWSER_E2E) {
          const result = await session.submitPin(pin);
          trackWorkerIdentity(result);
          if (result.ok && result.value.status === 'ACTIVE') {
            startLegacyRemotePreferenceFixture();
          }
          return result;
        }
        const state = await session.getState();
        if (!state.ok) {
          trackWorkerIdentity(state);
          return state;
        }
        if (shopId !== undefined || state.value.status === 'CONFIGURATION_REQUIRED') {
          const result = await bootstrapWithPin(pin, shopId);
          trackWorkerIdentity(result);
          return result;
        }

        const workerAuthentication = new OperationsWorkerAuthenticationService(
          session,
          {
            authenticate: async () => {
              const verified = await remoteGateway.authenticateWorker(pin);
              if (verified.status === 'AUTHENTICATED') {
                try {
                  await checkDayBeforeLogin(verified.worker.shopId);
                } catch (cause) {
                  return {
                    status: 'SERVER_ERROR',
                    message:
                      cause instanceof Error
                        ? cause.message
                        : 'Canonical Business Day lookup failed.',
                  };
                }
              }
              return verified;
            },
          },
          workerCredentialStore,
        );
        const result = await workerAuthentication.submitPin(pin);
        if (result.ok && result.value.status === 'ACTIVE') startRemoteRuntime(result.value.shopId);
        trackWorkerIdentity(result);
        return result;
      };

      const getState = async (): Promise<OperationsSessionResult> => {
        if (LEGACY_BROWSER_E2E) {
          const result = await session.getState();
          trackWorkerIdentity(result);
          return result;
        }
        const result = await fenceStaleBrowserSession(
          await session.getState(),
          async () => (await remoteGateway.currentSession())?.shopId ?? null,
          () => session.signOut(),
        );
        if (result.ok && result.value.status === 'ACTIVE') {
          startRemoteRuntime(result.value.shopId);
        } else {
          stopRemoteRuntime();
        }
        trackWorkerIdentity(result);
        return result;
      };

      const shouldCloseDayOnSignOut = async (): Promise<boolean> => {
        if (LEGACY_BROWSER_E2E) return true;
        const state = await session.getState();
        if (!state.ok || state.value.status !== 'ACTIVE') return true;
        const workerSession = await readModel.getOpenWorkerSession(state.value.businessDayId);
        if (workerSession === null) return true;
        const decision = await remoteGateway.prepareWorkerExit(
          state.value.businessDayId,
          workerSession.id,
        );
        return decision === 'END_DAY_REQUIRED';
      };

      const signOut = async (): Promise<OperationsSessionResult> => {
        const before = await session.getState();
        const result = await session.signOut();
        if (!LEGACY_BROWSER_E2E && result.ok && before.ok && before.value.status === 'ACTIVE') {
          try {
            // A second browser should see this departure before it decides
            // whether its operator is the final worker. Offline failures keep
            // the immutable sign-out event in the local outbox.
            await flushShopOutbox(before.value.shopId);
          } catch {
            // The original local mutation remains durable for next login.
          }
        }
        stopRemoteRuntime();
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
          rewardAuthority,
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
        shouldCloseDayOnSignOut,
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
    submitPin: async (pin: string, shopId?: string) =>
      (await browserRuntime()).submitPin(pin, shopId),
    signOut: async () => (await browserRuntime()).signOut(),
    shouldCloseDayOnSignOut: async () => (await browserRuntime()).shouldCloseDayOnSignOut(),
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
