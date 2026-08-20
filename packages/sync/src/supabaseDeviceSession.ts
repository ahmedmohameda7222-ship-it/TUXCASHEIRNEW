import { parseEntityId, type ShopId } from '@tux/domain';

export interface SupabaseDeviceSessionRecord {
  readonly shopId: ShopId;
  readonly deviceId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

export interface SupabaseDeviceSessionStore {
  load(): Promise<SupabaseDeviceSessionRecord | null>;
  save(session: SupabaseDeviceSessionRecord): Promise<void>;
}

export interface SupabaseDeviceSessionManagerOptions {
  readonly projectUrl: string;
  readonly publishableKey: string;
  readonly store: SupabaseDeviceSessionStore;
  readonly fetcher?: typeof fetch;
  readonly nowEpochSeconds?: () => number;
  readonly timeoutMs?: number;
}

const DEFAULT_SUPABASE_TIMEOUT_MS = 10_000;

function projectUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new TypeError('Supabase project URL must use HTTPS.');
  return url.origin;
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value.trim();
}

function positiveEpoch(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive epoch timestamp.`);
  }
  return value;
}

function timeoutMs(value: number | undefined): number {
  const normalized = value ?? DEFAULT_SUPABASE_TIMEOUT_MS;
  if (!Number.isSafeInteger(normalized) || normalized <= 0 || normalized > 120_000) {
    throw new RangeError('Supabase HTTP timeout must be between 1 and 120000 ms.');
  }
  return normalized;
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string | URL | Request,
  init: RequestInit | undefined,
  requestTimeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${requestTimeoutMs} ms.`, { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSessionResponse(value: unknown): SupabaseDeviceSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Supabase device session response must be an object.');
  }
  const source = value as Record<string, unknown>;
  return {
    shopId: parseEntityId<ShopId>(required(source['shopId'], 'Supabase session shopId')),
    deviceId: required(source['deviceId'], 'Supabase session deviceId'),
    accessToken: required(source['accessToken'], 'Supabase session accessToken'),
    refreshToken: required(source['refreshToken'], 'Supabase session refreshToken'),
    expiresAt: positiveEpoch(source['expiresAt'], 'Supabase session expiresAt'),
  };
}

function parseRefreshResponse(
  value: unknown,
  existing: SupabaseDeviceSessionRecord,
  nowEpochSeconds: () => number,
): SupabaseDeviceSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Supabase refresh response must be an object.');
  }
  const source = value as Record<string, unknown>;
  const expiresAt = source['expires_at'];
  const expiresIn = source['expires_in'];
  const normalizedExpiry =
    typeof expiresAt === 'number' && Number.isSafeInteger(expiresAt) && expiresAt > 0
      ? expiresAt
      : typeof expiresIn === 'number' && Number.isSafeInteger(expiresIn) && expiresIn > 0
        ? nowEpochSeconds() + expiresIn
        : null;
  if (normalizedExpiry === null) throw new TypeError('Supabase refresh response has no expiry.');
  return {
    ...existing,
    accessToken: required(source['access_token'], 'Supabase refresh access_token'),
    refreshToken: required(source['refresh_token'], 'Supabase refresh refresh_token'),
    expiresAt: normalizedExpiry,
  };
}

export class SupabaseDeviceSessionManager {
  readonly #projectUrl: string;
  readonly #publishableKey: string;
  readonly #store: SupabaseDeviceSessionStore;
  readonly #fetcher: typeof fetch;
  readonly #nowEpochSeconds: () => number;
  readonly #timeoutMs: number;
  #refreshInFlight: Promise<SupabaseDeviceSessionRecord> | null = null;

  constructor(options: SupabaseDeviceSessionManagerOptions) {
    this.#projectUrl = projectUrl(options.projectUrl);
    this.#publishableKey = required(options.publishableKey, 'Supabase publishable key');
    this.#store = options.store;
    this.#fetcher = options.fetcher ?? fetch;
    this.#nowEpochSeconds = options.nowEpochSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.#timeoutMs = timeoutMs(options.timeoutMs);
  }

  async enroll(input: {
    readonly enrollmentCode: string;
    readonly deviceId: string;
    readonly deviceLabel?: string;
  }): Promise<SupabaseDeviceSessionRecord> {
    const response = await fetchWithTimeout(
      this.#fetcher,
      `${this.#projectUrl}/functions/v1/device-enroll`,
      {
        method: 'POST',
        headers: {
          apikey: this.#publishableKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          enrollmentCode: required(input.enrollmentCode, 'Device enrollment code'),
          deviceId: required(input.deviceId, 'Device ID'),
          deviceLabel: input.deviceLabel?.trim() ?? '',
        }),
      },
      this.#timeoutMs,
      'TUX device enrollment',
    );
    if (!response.ok) {
      throw new Error(`TUX device enrollment failed with HTTP ${response.status}.`);
    }
    const session = parseSessionResponse(await response.json());
    await this.#store.save(session);
    return session;
  }

  async currentSession(): Promise<SupabaseDeviceSessionRecord | null> {
    const session = await this.#store.load();
    if (session === null) return null;
    if (session.expiresAt - this.#nowEpochSeconds() > 120) return session;
    return this.#refresh(session);
  }

  async requiredSession(): Promise<SupabaseDeviceSessionRecord> {
    const session = await this.currentSession();
    if (session === null) throw new Error('This TUX Operations device is not enrolled.');
    return session;
  }

  async authorizationHeaders(): Promise<Readonly<Record<string, string>>> {
    const session = await this.requiredSession();
    return {
      apikey: this.#publishableKey,
      authorization: `Bearer ${session.accessToken}`,
      'x-tux-device-id': session.deviceId,
    };
  }

  async #refresh(existing: SupabaseDeviceSessionRecord): Promise<SupabaseDeviceSessionRecord> {
    if (this.#refreshInFlight !== null) return this.#refreshInFlight;
    this.#refreshInFlight = (async () => {
      const response = await fetchWithTimeout(
        this.#fetcher,
        `${this.#projectUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            apikey: this.#publishableKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: existing.refreshToken }),
        },
        this.#timeoutMs,
        'Supabase device session refresh',
      );
      if (!response.ok) {
        throw new Error(`Supabase device session refresh failed with HTTP ${response.status}.`);
      }
      const refreshed = parseRefreshResponse(
        await response.json(),
        existing,
        this.#nowEpochSeconds,
      );
      await this.#store.save(refreshed);
      return refreshed;
    })();
    try {
      return await this.#refreshInFlight;
    } finally {
      this.#refreshInFlight = null;
    }
  }
}

export class SupabaseInboundConfigurationProvider {
  readonly #projectUrl: string;
  readonly #session: SupabaseDeviceSessionManager;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(input: {
    readonly projectUrl: string;
    readonly session: SupabaseDeviceSessionManager;
    readonly fetcher?: typeof fetch;
    readonly timeoutMs?: number;
  }) {
    this.#projectUrl = projectUrl(input.projectUrl);
    this.#session = input.session;
    this.#fetcher = input.fetcher ?? fetch;
    this.#timeoutMs = timeoutMs(input.timeoutMs);
  }

  async discoverVersion(shopId: ShopId): Promise<number | null> {
    const response = await this.#request(shopId, null);
    const value = response['version'];
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError('Remote configuration version is invalid.');
    }
    return value;
  }

  async fetchCompleteConfiguration(shopId: ShopId, version: number): Promise<unknown> {
    const response = await this.#request(shopId, version);
    if (response['version'] !== version)
      throw new TypeError('Remote configuration version mismatch.');
    return response['bundle'];
  }

  async #request(shopId: ShopId, version: number | null): Promise<Record<string, unknown>> {
    const session = await this.#session.requiredSession();
    if (session.shopId !== shopId) throw new Error('Device session belongs to a different shop.');
    const url = new URL(`${this.#projectUrl}/functions/v1/operations-config`);
    url.searchParams.set('shopId', shopId);
    if (version !== null) url.searchParams.set('version', String(version));
    const response = await fetchWithTimeout(
      this.#fetcher,
      url,
      { headers: await this.#session.authorizationHeaders() },
      this.#timeoutMs,
      'Remote Operations configuration request',
    );
    if (!response.ok)
      throw new Error(`Remote configuration request failed with HTTP ${response.status}.`);
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new TypeError('Remote configuration response must be an object.');
    }
    return body as Record<string, unknown>;
  }
}
