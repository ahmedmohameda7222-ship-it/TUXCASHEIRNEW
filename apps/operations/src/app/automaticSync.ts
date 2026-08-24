import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { AutomaticOutboxScheduler, HttpOutboxTransport, OutboxSyncService } from '@tux/sync';
import { browserSyncStatusStore } from './syncStatus';

export function startBrowserAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
}): AutomaticOutboxScheduler {
  const endpoint = new URL('/api/operations-sync', window.location.origin).toString();
  const service = new OutboxSyncService(input.database, new HttpOutboxTransport({ endpoint }), {
    now: input.now,
  });
  const scheduler = new AutomaticOutboxScheduler(service, {
    onStart: () => browserSyncStatusStore.markSyncStarted(),
    onResult: (result) => browserSyncStatusStore.markSyncFinished(result),
  });
  browserSyncStatusStore.markRemoteConfigured();
  if (typeof window.addEventListener === 'function' && typeof navigator !== 'undefined') {
    browserSyncStatusStore.setOnline(navigator.onLine);
    window.addEventListener('online', () => browserSyncStatusStore.setOnline(true));
    window.addEventListener('offline', () => browserSyncStatusStore.setOnline(false));
  }
  scheduler.start();
  return scheduler;
}
