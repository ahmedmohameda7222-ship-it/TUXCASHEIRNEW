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

export type SupabaseDeviceSessionResolution =
  | { readonly status: 'VALID'; readonly session: SupabaseDeviceSessionRecord }
  | { readonly status: 'TRANSPORT_UNAVAILABLE'; readonly message: string }
  | { readonly status: 'AUTHORITATIVELY_INVALID'; readonly message: string }
  | { readonly status: 'PROTOCOL_ERROR'; readonly message: string }
  | {
      readonly status: 'LOCAL_PERSISTENCE_ERROR';
      readonly message: string;
      readonly cause: unknown;
    }
  | { readonly status: 'NOT_ENROLLED'; readonly message: string };

export class SupabaseDeviceSessionError extends Error {
  constructor(
    readonly status: Exclude<SupabaseDeviceSessionResolution['status'], 'VALID' | 'NOT_ENROLLED'>,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SupabaseDeviceSessionError';
  }
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
  #refreshInFlight: Promise<SupabaseDeviceSessionResolution> | null = null;

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

  async resolveSession(): Promise<SupabaseDeviceSessionResolution> {
    let session: SupabaseDeviceSessionRecord | null;
    try {
      session = await this.#store.load();
    } catch (cause) {
      return {
        status: 'LOCAL_PERSISTENCE_ERROR',
        message: 'The enrolled device session could not be loaded locally.',
        cause,
      };
    }
    if (session === null) {
      return { status: 'NOT_ENROLLED', message: 'This TUX Operations device is not enrolled.' };
    }
    if (session.expiresAt - this.#nowEpochSeconds() > 120) {
      return { status: 'VALID', session };
    }
    return this.#refresh(session);
  }

  async currentSession(): Promise<SupabaseDeviceSessionRecord | null> {
    const resolution = await this.resolveSession();
    if (resolution.status === 'VALID') return resolution.session;
    if (resolution.status === 'NOT_ENROLLED') return null;
    throw new SupabaseDeviceSessionError(resolution.status, resolution.message, {
      cause: resolution.status === 'LOCAL_PERSISTENCE_ERROR' ? resolution.cause : undefined,
    });
  }

  async requiredSession(): Promise<SupabaseDeviceSessionRecord> {
    const resolution = await this.resolveSession();
    if (resolution.status === 'VALID') return resolution.session;
    if (resolution.status === 'NOT_ENROLLED') throw new Error(resolution.message);
    throw new SupabaseDeviceSessionError(resolution.status, resolution.message, {
      cause: resolution.status === 'LOCAL_PERSISTENCE_ERROR' ? resolution.cause : undefined,
    });
  }

  authorizationHeadersFor(session: SupabaseDeviceSessionRecord): Readonly<Record<string, string>> {
    return {
      apikey: this.#publishableKey,
      authorization: `Bearer ${session.accessToken}`,
      'x-tux-device-id': session.deviceId,
    };
  }

  async authorizationHeaders(): Promise<Readonly<Record<string, string>>> {
    return this.authorizationHeadersFor(await this.requiredSession());
  }

  async #refresh(existing: SupabaseDeviceSessionRecord): Promise<SupabaseDeviceSessionResolution> {
    if (this.#refreshInFlight !== null) return this.#refreshInFlight;
    this.#refreshInFlight = (async () => {
      let response: Response;
      try {
        response = await fetchWithTimeout(
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
      } catch {
        return {
          status: 'TRANSPORT_UNAVAILABLE',
          message: 'The device-session authority is temporarily unavailable.',
        };
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return {
          status: 'AUTHORITATIVELY_INVALID',
          message: 'The enrolled device session is no longer valid.',
        };
      }
      if (!response.ok) {
        return {
          status: 'PROTOCOL_ERROR',
          message: `Device-session refresh failed with HTTP ${response.status}.`,
        };
      }

      let refreshed: SupabaseDeviceSessionRecord;
      try {
        refreshed = parseRefreshResponse(await response.json(), existing, this.#nowEpochSeconds);
      } catch {
        return {
          status: 'PROTOCOL_ERROR',
          message: 'The device-session authority returned an invalid refresh response.',
        };
      }

      try {
        await this.#store.save(refreshed);
      } catch (cause) {
        return {
          status: 'LOCAL_PERSISTENCE_ERROR',
          message: 'The refreshed device session could not be persisted locally.',
          cause,
        };
      }
      return { status: 'VALID', session: refreshed };
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
      { headers: this.#session.authorizationHeadersFor(session) },
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
