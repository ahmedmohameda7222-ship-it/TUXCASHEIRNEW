import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpOutboxTransport,
  OutboxSyncService,
  type SupabaseDeviceSessionManager,
} from '@tux/sync';

export function startDesktopAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
  readonly sessionManager?: SupabaseDeviceSessionManager;
}): AutomaticOutboxScheduler | null {
  const explicitEndpoint = process.env['TUX_SYNC_ENDPOINT']?.trim();
  const supabaseUrl = process.env['TUX_SUPABASE_URL']?.trim();
  const endpoint =
    explicitEndpoint && explicitEndpoint.length > 0
      ? explicitEndpoint
      : supabaseUrl && supabaseUrl.length > 0
        ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/operations-sync`
        : null;
  if (endpoint === null) return null;

  if (input.sessionManager === undefined) {
    // Remote Operations sync must never fall back to a publishable key or embedded
    // service credential. No enrolled device session means sync remains safely local.
    return null;
  }

  const transport = new HttpOutboxTransport({
    endpoint,
    headerProvider: () => input.sessionManager?.authorizationHeaders() ?? {},
  });
  const service = new OutboxSyncService(input.database, transport, { now: input.now });
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
