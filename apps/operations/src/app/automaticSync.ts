import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpOutboxTransport,
  OutboxSyncService,
  type SupabaseDeviceSessionManager,
} from '@tux/sync';

export function startBrowserAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
  readonly projectUrl: string;
  readonly sessionManager: SupabaseDeviceSessionManager;
}): AutomaticOutboxScheduler {
  const explicitEndpoint = import.meta.env['VITE_TUX_SYNC_ENDPOINT']?.trim();
  const endpoint =
    explicitEndpoint && explicitEndpoint.length > 0
      ? explicitEndpoint
      : `${input.projectUrl.replace(/\/$/, '')}/functions/v1/operations-sync`;

  const transport = new HttpOutboxTransport({
    endpoint,
    headerProvider: () => input.sessionManager.authorizationHeaders(),
  });
  const service = new OutboxSyncService(input.database, transport, { now: input.now });
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
