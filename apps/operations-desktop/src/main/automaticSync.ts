import * as path from 'node:path';
import {
  WorkerMenuLayoutConflictError,
  type RemoteWorkerMenuLayout,
  type RemoteWorkerUiPreferences,
  type WorkerMenuLayoutRemoteGateway,
  type WorkerUiPreferencesRemoteGateway,
} from '@tux/application';
import {
  parseWorkerMenuLayout,
  parseWorkerUiPreferences,
  type CategoryAlignment,
  type Instant,
  type MenuCategoryId,
  type ProductId,
  type ProductOrderByCategory,
  type ShopId,
  type SystemAccentColor,
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

interface DesktopWorkerPreferenceSessionManager {
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
          productOrder: (value as Record<string, unknown>)['product_order'],
          accentColor: (value as Record<string, unknown>)['accent_color'],
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
    productOrder: parsed.productOrder,
    accentColor: parsed.accentColor,
    serverVersion: parsed.serverVersion,
    updatedAt: parsed.updatedAt,
  };
}

function parseRemoteWorkerMenuLayout(value: unknown): RemoteWorkerMenuLayout {
  const parsed = parseWorkerMenuLayout(
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? {
          shopId: (value as Record<string, unknown>)['shop_id'],
          workerId: (value as Record<string, unknown>)['worker_id'],
          categoryOrder: (value as Record<string, unknown>)['category_order'],
          categoryAlignment: (value as Record<string, unknown>)['category_alignment'],
          productOrderByCategory: (value as Record<string, unknown>)['product_order_by_category'],
          layoutVersion: (value as Record<string, unknown>)['layout_version'],
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
    productOrderByCategory: parsed.productOrderByCategory,
    layoutVersion: parsed.layoutVersion,
    updatedAt: parsed.updatedAt,
  };
}

function oneWorkerUiPreferenceRow(value: unknown): RemoteWorkerUiPreferences {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new TypeError('Worker preference response must contain one row.');
    return parseRemoteWorkerUiPreferences(value[0]);
  }
  return parseRemoteWorkerUiPreferences(value);
}

function oneWorkerMenuLayoutRow(value: unknown): RemoteWorkerMenuLayout {
  if (Array.isArray(value)) {
    if (value.length !== 1)
      throw new TypeError('Worker Menu Layout response must contain one row.');
    return parseRemoteWorkerMenuLayout(value[0]);
  }
  return parseRemoteWorkerMenuLayout(value);
}

abstract class DesktopWorkerScopedGateway {
  readonly projectUrl: string;
  readonly sessionManager: DesktopWorkerPreferenceSessionManager;
  readonly fetcher: typeof fetch;

  constructor(input: {
    readonly projectUrl: string;
    readonly sessionManager: DesktopWorkerPreferenceSessionManager;
    readonly fetcher?: typeof fetch;
  }) {
    this.projectUrl = projectOrigin(input.projectUrl);
    this.sessionManager = input.sessionManager;
    this.fetcher = input.fetcher ?? fetch;
  }

  async headersForShop(shopId: ShopId): Promise<Readonly<Record<string, string>>> {
    const session = await this.sessionManager.requiredSession();
    if (session.shopId !== shopId) {
      throw new Error('Device session belongs to a different shop.');
    }
    return this.sessionManager.authorizationHeaders();
  }
}

export class SupabaseDesktopWorkerMenuLayoutGateway
  extends DesktopWorkerScopedGateway
  implements WorkerMenuLayoutRemoteGateway
{
  async getWorkerMenuLayout(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerMenuLayout | null> {
    const headers = await this.headersForShop(shopId);
    const target = new URL(`${this.projectUrl}/rest/v1/worker_menu_layouts`);
    target.searchParams.set('shop_id', `eq.${shopId}`);
    target.searchParams.set('worker_id', `eq.${workerId}`);
    target.searchParams.set(
      'select',
      'shop_id,worker_id,category_order,category_alignment,product_order_by_category,layout_version,updated_at',
    );
    target.searchParams.set('limit', '1');

    const response = await this.fetcher(target, {
      method: 'GET',
      headers: { ...headers, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Worker Menu Layout request failed with HTTP ${response.status}.`);
    }
    const payload: unknown = await response.json();
    if (Array.isArray(payload) && payload.length === 0) return null;
    return oneWorkerMenuLayoutRow(payload);
  }

  async putWorkerMenuLayout(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrderByCategory: ProductOrderByCategory;
    readonly expectedLayoutVersion: number | null;
  }): Promise<RemoteWorkerMenuLayout> {
    const headers = await this.headersForShop(input.shopId);
    const response = await this.fetcher(
      `${this.projectUrl}/rest/v1/rpc/put_worker_menu_layout_v2`,
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
          p_product_order_by_category: input.productOrderByCategory,
          p_expected_layout_version: input.expectedLayoutVersion,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (detail.includes('TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT')) {
        throw new WorkerMenuLayoutConflictError();
      }
      throw new Error(`Worker Menu Layout update failed with HTTP ${response.status}.`);
    }
    return oneWorkerMenuLayoutRow(await response.json());
  }
}

export class SupabaseDesktopWorkerUiPreferencesGateway
  extends DesktopWorkerScopedGateway
  implements WorkerUiPreferencesRemoteGateway
{
  async getWorkerUiPreferences(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerUiPreferences | null> {
    const headers = await this.headersForShop(shopId);
    const target = new URL(`${this.projectUrl}/rest/v1/worker_ui_preferences`);
    target.searchParams.set('shop_id', `eq.${shopId}`);
    target.searchParams.set('worker_id', `eq.${workerId}`);
    target.searchParams.set(
      'select',
      'shop_id,worker_id,category_order,category_alignment,product_order,accent_color,server_version,updated_at',
    );
    target.searchParams.set('limit', '1');

    const response = await this.fetcher(target, {
      method: 'GET',
      headers: { ...headers, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Worker preference request failed with HTTP ${response.status}.`);
    }

    const payload: unknown = await response.json();
    if (Array.isArray(payload) && payload.length === 0) return null;
    return oneWorkerUiPreferenceRow(payload);
  }

  async putWorkerUiPreferences(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
    readonly accentColor: SystemAccentColor | null;
  }): Promise<RemoteWorkerUiPreferences> {
    const headers = await this.headersForShop(input.shopId);
    const response = await this.fetcher(
      `${this.projectUrl}/rest/v1/rpc/put_worker_ui_preferences`,
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
          p_product_order: input.productOrder,
          p_accent_color: input.accentColor,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Worker preference update failed with HTTP ${response.status}.`);
    }
    return oneWorkerUiPreferenceRow(await response.json());
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
