import type { Instant, ShopId } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpInventoryFeedTransport,
  HttpOutboxTransport,
  InventoryConvergenceService,
  OutboxSyncService,
} from '@tux/sync';
import { browserSyncStatusStore } from './syncStatus';

const INVENTORY_SYNC_INTERVAL_MS = 15_000;

export function startBrowserAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
  readonly shopId?: ShopId;
}): AutomaticOutboxScheduler {
  const endpoint = new URL('/api/operations-sync', window.location.origin).toString();
  const service = new OutboxSyncService(input.database, new HttpOutboxTransport({ endpoint }), {
    now: input.now,
  });
  const scheduler = new AutomaticOutboxScheduler(service, {
    onStart: () => browserSyncStatusStore.markSyncStarted(),
    onResult: (result) => browserSyncStatusStore.markSyncFinished(result),
  });

  let inventoryRunning = false;
  const synchronizeInventory = async (): Promise<void> => {
    if (input.shopId === undefined || inventoryRunning) return;
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

  browserSyncStatusStore.markRemoteConfigured();
  if (input.shopId !== undefined) {
    void synchronizeInventory();
    if (typeof window.setInterval === 'function') {
      window.setInterval(() => void synchronizeInventory(), INVENTORY_SYNC_INTERVAL_MS);
    }
  }

  if (typeof window.addEventListener === 'function' && typeof navigator !== 'undefined') {
    browserSyncStatusStore.setOnline(navigator.onLine);
    window.addEventListener('online', () => {
      browserSyncStatusStore.setOnline(true);
      void synchronizeInventory();
    });
    window.addEventListener('offline', () => browserSyncStatusStore.setOnline(false));
  }
  scheduler.start();
  return scheduler;
}
