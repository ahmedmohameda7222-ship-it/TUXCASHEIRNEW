import { parseEntityId, type BusinessDayId, type Instant, type ShopId } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpInventoryFeedTransport,
  HttpOrderLifecycleFeedTransport,
  HttpOutboxTransport,
  InventoryConvergenceService,
  OrderLifecycleConvergenceService,
  OutboxSyncService,
} from '@tux/sync';
import { browserSyncStatusStore } from './syncStatus';
import { recoverMissingBusinessDayStart } from './businessDayStartRecovery';

const INVENTORY_SYNC_INTERVAL_MS = 15_000;
const MISSING_BUSINESS_DAY_DIAGNOSTIC =
  /Business Day ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) has not materialized\./i;

export interface BrowserRewardClaimReconciler {
  reconcileClaims(
    shopId: ShopId,
    hasCommittedCheckoutIntent: (
      checkoutIntentId: string,
      reservationId: string,
    ) => Promise<boolean>,
  ): Promise<void>;
}

export interface BrowserAutomaticSyncHandle {
  stop(): void;
}

export function startBrowserAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
  readonly shopId?: ShopId;
  readonly rewardClaims?: BrowserRewardClaimReconciler;
}): BrowserAutomaticSyncHandle {
  const endpoint = new URL('/api/operations-sync', window.location.origin).toString();
  const service = new OutboxSyncService(
    input.database,
    new HttpOutboxTransport({
      endpoint,
      onDependencyMissing: async (event, missingDayId) => {
        const businessDayId = parseEntityId<BusinessDayId>(missingDayId);
        await recoverMissingBusinessDayStart({
          database: input.database,
          businessDayId,
          shopId: event.shopId,
          createUuid: () => crypto.randomUUID(),
        });
      },
    }),
    { now: input.now },
    input.shopId,
  );
  let stopped = false;
  const scheduler = new AutomaticOutboxScheduler(service, {
    onStart: () => {
      if (!stopped) browserSyncStatusStore.markSyncStarted();
    },
    onResult: (result) => {
      if (!stopped) browserSyncStatusStore.markSyncFinished(result);
    },
  });

  const recoverPreviousMissingBusinessDay = async (): Promise<void> => {
    if (input.shopId === undefined) return;
    const deliveryStatus = await input.database.transaction((transaction) =>
      transaction.outbox.getDeliveryStatus(input.shopId),
    );
    const missingDayId = deliveryStatus.lastError?.match(MISSING_BUSINESS_DAY_DIAGNOSTIC)?.[1];
    if (missingDayId === undefined) return;
    await recoverMissingBusinessDayStart({
      database: input.database,
      businessDayId: parseEntityId<BusinessDayId>(missingDayId),
      shopId: input.shopId,
      createUuid: () => crypto.randomUUID(),
    });
    if (!stopped) scheduler.trigger();
  };

  let convergenceTimer: number | null = null;
  let inventoryRunning = false;
  let lifecycleRunning = false;
  let rewardClaimsRunning = false;
  const synchronizeRewardClaims = async (): Promise<void> => {
    if (
      stopped ||
      input.shopId === undefined ||
      input.rewardClaims === undefined ||
      rewardClaimsRunning
    ) {
      return;
    }
    rewardClaimsRunning = true;
    try {
      await input.rewardClaims.reconcileClaims(
        input.shopId,
        async (checkoutIntentId, reservationId) => {
          const order = await input.database.transaction((transaction) =>
            transaction.orders.getByIdempotencyKey(input.shopId!, checkoutIntentId),
          );
          return order?.rewardReservationId === reservationId;
        },
      );
    } catch {
      // Canonical claims remain protected until a later startup/reconnect reconciliation succeeds.
    } finally {
      rewardClaimsRunning = false;
    }
  };
  const synchronizeInventory = async (): Promise<void> => {
    if (stopped || input.shopId === undefined || inventoryRunning) return;
    inventoryRunning = true;
    try {
      const inventoryEndpoint = new URL(
        '/api/operations-inventory',
        window.location.origin,
      ).toString();
      const convergence = new InventoryConvergenceService(
        input.database,
        new HttpInventoryFeedTransport({ endpoint: inventoryEndpoint }),
      );
      await convergence.syncShop(input.shopId);
    } catch {
      // Operations remains usable from its last known-good local inventory projection.
    } finally {
      inventoryRunning = false;
    }
  };

  const synchronizeLifecycle = async (): Promise<void> => {
    if (stopped || input.shopId === undefined || lifecycleRunning) return;
    lifecycleRunning = true;
    try {
      const lifecycleEndpoint = new URL(
        '/api/operations-order-lifecycle',
        window.location.origin,
      ).toString();
      const convergence = new OrderLifecycleConvergenceService(
        input.database,
        new HttpOrderLifecycleFeedTransport({ endpoint: lifecycleEndpoint }),
      );
      await convergence.syncShop(input.shopId);
    } catch {
      // Operations remains usable from its last known-good local lifecycle projection.
    } finally {
      lifecycleRunning = false;
    }
  };

  browserSyncStatusStore.markRemoteConfigured();
  if (input.shopId !== undefined) {
    void synchronizeRewardClaims();
    void synchronizeInventory();
    void synchronizeLifecycle();
    if (typeof window.setInterval === 'function') {
      convergenceTimer = window.setInterval(() => {
        void synchronizeRewardClaims();
        void synchronizeInventory();
        void synchronizeLifecycle();
      }, INVENTORY_SYNC_INTERVAL_MS);
    }
  }

  const onOnline = (): void => {
    if (stopped) return;
    browserSyncStatusStore.setOnline(true);
    scheduler.trigger();
    void synchronizeRewardClaims();
    void synchronizeInventory();
    void synchronizeLifecycle();
  };
  const onOffline = (): void => {
    if (!stopped) browserSyncStatusStore.setOnline(false);
  };

  const registeredNetworkListeners =
    typeof window.addEventListener === 'function' && typeof navigator !== 'undefined';
  if (registeredNetworkListeners) {
    browserSyncStatusStore.setOnline(navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  scheduler.start();
  void recoverPreviousMissingBusinessDay().catch(() => {
    // The ordinary delivery callback retries the exact recovery when the dependency responds 425.
  });
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      scheduler.stop();
      if (convergenceTimer !== null) {
        window.clearInterval(convergenceTimer);
        convergenceTimer = null;
      }
      if (registeredNetworkListeners) {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    },
  };
}
