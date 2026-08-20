import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { AutomaticOutboxScheduler, HttpOutboxTransport, OutboxSyncService } from '@tux/sync';

export function startDesktopAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
}): AutomaticOutboxScheduler | null {
  const endpoint = process.env['TUX_SYNC_ENDPOINT']?.trim();
  if (endpoint === undefined || endpoint.length === 0) return null;

  const token = process.env['TUX_SYNC_BEARER_TOKEN']?.trim();
  const transport =
    token === undefined || token.length === 0
      ? new HttpOutboxTransport({ endpoint })
      : new HttpOutboxTransport({
          endpoint,
          headers: { authorization: `Bearer ${token}` },
        });
  const service = new OutboxSyncService(input.database, transport, { now: input.now });
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
