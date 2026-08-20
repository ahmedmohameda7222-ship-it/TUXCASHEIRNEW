import * as path from 'node:path';
import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpOutboxTransport,
  OutboxSyncService,
  SupabaseDeviceSessionManager,
  type SupabaseDeviceSessionRecord,
} from '@tux/sync';
import { app } from 'electron';
import { ElectronSafeStorageDeviceSessionStore } from './secureDeviceSessionStore';

function createSessionManager(): SupabaseDeviceSessionManager | null {
  const projectUrl = process.env['TUX_SUPABASE_URL']?.trim();
  const publishableKey = process.env['TUX_SUPABASE_PUBLISHABLE_KEY']?.trim();
  if (!projectUrl || !publishableKey) return null;
  return new SupabaseDeviceSessionManager({
    projectUrl,
    publishableKey,
    store: new ElectronSafeStorageDeviceSessionStore(
      path.join(app.getPath('userData'), 'tux-device-session.bin'),
    ),
  });
}

export async function ensureDesktopSupabaseDeviceSession(
  manager: SupabaseDeviceSessionManager,
): Promise<SupabaseDeviceSessionRecord> {
  const existing = await manager.currentSession();
  if (existing !== null) return existing;

  const enrollmentCode = process.env['TUX_DEVICE_ENROLLMENT_CODE']?.trim();
  const deviceId = process.env['TUX_DEVICE_ID']?.trim();
  if (!enrollmentCode || !deviceId) {
    throw new Error(
      'TUX Operations remote integration requires an enrolled device or first-run enrollment credentials.',
    );
  }
  return manager.enroll({
    enrollmentCode,
    deviceId,
    deviceLabel: process.env['TUX_DEVICE_LABEL']?.trim(),
  });
}

export function createDesktopSupabaseDeviceSessionManager(): SupabaseDeviceSessionManager | null {
  return createSessionManager();
}

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

  const sessionManager = input.sessionManager ?? createSessionManager();
  if (sessionManager === null) return null;

  let enrollmentInFlight: Promise<Readonly<Record<string, string>>> | null = null;
  const headerProvider = async () => {
    enrollmentInFlight ??= ensureDesktopSupabaseDeviceSession(sessionManager)
      .then(() => sessionManager.authorizationHeaders())
      .finally(() => {
        enrollmentInFlight = null;
      });
    return enrollmentInFlight;
  };

  const transport = new HttpOutboxTransport({ endpoint, headerProvider });
  const service = new OutboxSyncService(input.database, transport, { now: input.now });
  const scheduler = new AutomaticOutboxScheduler(service);
  scheduler.start();
  return scheduler;
}
