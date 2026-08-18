import type { ApplicationCommandCoordinator } from '@tux/application';
import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { AutomaticOutboxScheduler, HttpOutboxTransport, OutboxSyncService } from '@tux/sync';

export function startDesktopAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly coordinator: ApplicationCommandCoordinator;
  readonly now: () => Instant;
}): AutomaticOutboxScheduler | null {
  const endpoint = process.env['TUX_SYNC_ENDPOINT']?.trim();
  if (endpoint === undefined || endpoint.length === 0) return null;

  const token = process.env['TUX_SYNC_BEARER_TOKEN']?.trim();
  const service = new OutboxSyncService(
    input.database,
    new HttpOutboxTransport({
      endpoint,
      headers:
        token === undefined || token.length === 0
          ? undefined
          : { authorization: `Bearer ${token}` },
    }),
    { now: input.now },
    input.coordinator,
  );
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
