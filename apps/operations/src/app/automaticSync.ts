import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { AutomaticOutboxScheduler, HttpOutboxTransport, OutboxSyncService } from '@tux/sync';

export function startBrowserAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
}): AutomaticOutboxScheduler | null {
  const endpoint = import.meta.env['VITE_TUX_SYNC_ENDPOINT']?.trim();
  if (endpoint === undefined || endpoint.length === 0) return null;

  const service = new OutboxSyncService(
    input.database,
    new HttpOutboxTransport({ endpoint }),
    { now: input.now },
  );
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
