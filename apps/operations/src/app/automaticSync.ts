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
  scheduler.start();
  return scheduler;
}
