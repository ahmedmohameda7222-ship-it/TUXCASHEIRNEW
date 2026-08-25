import * as path from 'node:path';
import type {
  RemoteWorkerUiPreferences,
  WorkerUiPreferencesRemoteGateway,
} from '@tux/application';
import {
  parseWorkerUiPreferences,
  type CategoryAlignment,
  type Instant,
  type MenuCategoryId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import {
  AutomaticOutboxScheduler,
  HttpOutboxTransport,
  OutboxSyncService,
  SupabaseDeviceSessionManager,
  type OutboxSyncSummary,
  type SupabaseDeviceSessionRecord,
} from '@tux/sync';
import { app } from 'electron';
import { ElectronSafeStorageDeviceSessionStore } from './secureDeviceSessionStore';

interface DesktopWorkerUiPreferencesSessionManager {
  requiredSession(): Promise<SupabaseDeviceSessionRecord>;
  authorizationHeaders(): Promise<Readonly<Record<string, string>>>;
}

function projectOrigin(rawProjectUrl: string): string {
  const url = new URL(rawProjectUrl);
  if (url.protocol !== 'https:') throw new Error('Supabase project URL must use HTTPS.');
  return url.origin;
}

function parseRemoteWorkerUiPreferences(value: unknown): RemoteWorkerUiPreferences {
  const parsed = parseWorkerUiPreferences(
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? {
          shopId: (value as Record<string, unknown>)['shop_id'],
          workerId: (value as Record<string, unknown>)['worker_id'],
          categoryOrder: (value as Record<string, unknown>)['category_order'],
          categoryAlignment: (value as Record<string, unknown>)['category_alignment'],
          serverVersion: (value as Record<string, unknown>)['server_version'],
          updatedAt: (value as Record<string, unknown>)['updated_at'],
          syncState: 'CLEAN',
        }
      : value,
  );
  return {
    shopId: parsed.shopId,
    workerId: parsed.workerId,
    categoryOrder: parsed.categoryOrder,
    categoryAlignment: parsed.categoryAlignment,
    serverVersion: parsed.serverVersion,
    updatedAt: parsed.updatedAt,
  };
}

function oneRemoteRow(value: unknown): RemoteWorkerUiPreferences {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new TypeError('Worker preference response must contain one row.');
    return parseRemoteWorkerUiPreferences(value[0]);
  }
  return parseRemoteWorkerUiPreferences(value);
}

export class SupabaseDesktopWorkerUiPreferencesGateway
  implements WorkerUiPreferencesRemoteGateway
{
  readonly #projectUrl: string;
  readonly #sessionManager: DesktopWorkerUiPreferencesSessionManager;
  readonly #fetcher: typeof fetch;

  constructor(input: {
    readonly projectUrl: string;
    readonly sessionManager: DesktopWorkerUiPreferencesSessionManager;
    readonly fetcher?: typeof fetch;
  }) {
    this.#projectUrl = projectOrigin(input.projectUrl);
    this.#sessionManager = input.sessionManager;
    this.#fetcher = input.fetcher ?? fetch;
  }

  async #headersForShop(shopId: ShopId): Promise<Readonly<Record<string, string>>> {
    const session = await this.#sessionManager.requiredSession();
    if (session.shopId !== shopId) {
      throw new Error('Device session belongs to a different shop.');
    }
    return this.#sessionManager.authorizationHeaders();
  }

  async getWorkerUiPreferences(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerUiPreferences | null> {
    const headers = await this.#headersForShop(shopId);
    const target = new URL(`${this.#projectUrl}/rest/v1/worker_ui_preferences`);
    target.searchParams.set('shop_id', `eq.${shopId}`);
    target.searchParams.set('worker_id', `eq.${workerId}`);
    target.searchParams.set(
      'select',
      'shop_id,worker_id,category_order,category_alignment,server_version,updated_at',
    );
    target.searchParams.set('limit', '1');

    const response = await this.#fetcher(target, {
      method: 'GET',
      headers: { ...headers, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Worker preference request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (Array.isArray(payload) && payload.length === 0) return null;
    return oneRemoteRow(payload);
  }

  async putWorkerUiPreferences(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
  }): Promise<RemoteWorkerUiPreferences> {
    const headers = await this.#headersForShop(input.shopId);
    const response = await this.#fetcher(
      `${this.#projectUrl}/rest/v1/rpc/put_worker_ui_preferences`,
      {
        method: 'POST',
        headers: {
          ...headers,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          p_shop_id: input.shopId,
          p_worker_id: input.workerId,
          p_category_order: input.categoryOrder,
          p_category_alignment: input.categoryAlignment,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Worker preference update failed with HTTP ${response.status}.`);
    }
    return oneRemoteRow(await response.json());
  }
}

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
  const deviceLabel = process.env['TUX_DEVICE_LABEL']?.trim();
  if (!enrollmentCode || !deviceId) {
    throw new Error(
      'TUX Operations remote integration requires an enrolled device or first-run enrollment credentials.',
    );
  }
  return manager.enroll({
    enrollmentCode,
    deviceId,
    ...(deviceLabel ? { deviceLabel } : {}),
  });
}

export function createDesktopSupabaseDeviceSessionManager(): SupabaseDeviceSessionManager | null {
  return createSessionManager();
}

export function startDesktopAutomaticSync(input: {
  readonly database: OperationsDatabase;
  readonly now: () => Instant;
  readonly sessionManager?: SupabaseDeviceSessionManager;
  readonly onConfigured?: () => void;
  readonly onStart?: () => void;
  readonly onResult?: (result: OutboxSyncSummary | Error) => void;
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
  const scheduler = new AutomaticOutboxScheduler(service, {
    ...(input.onStart === undefined ? {} : { onStart: input.onStart }),
    ...(input.onResult === undefined ? {} : { onResult: input.onResult }),
  });
  input.onConfigured?.();
  scheduler.start();
  return scheduler;
}
