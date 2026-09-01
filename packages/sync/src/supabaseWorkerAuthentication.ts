import { parseEntityId, type ShopId, type Worker, type WorkerId } from '@tux/domain';
import type {
  SupabaseDeviceSessionRecord,
  SupabaseDeviceSessionResolution,
} from './supabaseDeviceSession';

export type SupabaseWorkerAuthenticationResult =
  | { readonly status: 'AUTHENTICATED'; readonly worker: Worker }
  | { readonly status: 'REJECTED'; readonly message: string }
  | { readonly status: 'THROTTLED'; readonly message: string }
  | { readonly status: 'DEVICE_SESSION_INVALID'; readonly message: string }
  | { readonly status: 'INVALID_REQUEST'; readonly message: string }
  | { readonly status: 'INVALID_RESPONSE'; readonly message: string }
  | { readonly status: 'SERVER_ERROR'; readonly message: string }
  | { readonly status: 'LOCAL_PERSISTENCE_ERROR'; readonly message: string; readonly cause: unknown }
  | { readonly status: 'UNAVAILABLE'; readonly message: string };

interface WorkerAuthenticationSessionManager {
  resolveSession(): Promise<SupabaseDeviceSessionResolution>;
  authorizationHeadersFor(
    session: SupabaseDeviceSessionRecord,
  ): Readonly<Record<string, string>>;
}

export interface SupabaseWorkerAuthenticatorOptions {
  readonly projectUrl: string;
  readonly sessionManager: WorkerAuthenticationSessionManager;
  readonly fetcher?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeProjectUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new TypeError('Supabase project URL must use HTTPS.');
  return url.origin;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 120_000) {
    throw new RangeError('Worker authentication timeout must be between 1 and 120000 ms.');
  }
  return timeout;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseWorker(value: unknown, expectedShopId: ShopId): Worker | null {
  const source = object(value);
  if (source === null || source['active'] !== true) return null;
  const id = requiredString(source['id']);
  const shopId = requiredString(source['shopId']);
  const displayName = requiredString(source['displayName']);
  const pinHash = requiredString(source['pinHash']);
  if (id === null || shopId === null || displayName === null || pinHash === null) return null;
  try {
    const parsedShopId = parseEntityId<ShopId>(shopId);
    if (parsedShopId !== expectedShopId) return null;
    return {
      id: parseEntityId<WorkerId>(id),
      shopId: parsedShopId,
      displayName,
      pinHash,
      active: true,
    };
  } catch {
    return null;
  }
}

function messageForStatus(status: number): string {
  if (status === 400) return 'Worker authentication request was rejected.';
  if (status === 429) return 'Too many PIN attempts. Try again later.';
  return 'Worker authentication failed on the server.';
}

export class SupabaseWorkerAuthenticator {
  readonly #projectUrl: string;
  readonly #sessionManager: WorkerAuthenticationSessionManager;
  readonly #fetcher: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SupabaseWorkerAuthenticatorOptions) {
    this.#projectUrl = normalizeProjectUrl(options.projectUrl);
    this.#sessionManager = options.sessionManager;
    this.#fetcher = options.fetcher ?? fetch;
    this.#timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  async authenticate(pin: string): Promise<SupabaseWorkerAuthenticationResult> {
    const normalizedPin = pin.trim();
    if (!/^\d{4,12}$/.test(normalizedPin)) {
      return { status: 'INVALID_REQUEST', message: 'Enter a valid worker PIN.' };
    }

    let resolution: SupabaseDeviceSessionResolution;
    try {
      resolution = await this.#sessionManager.resolveSession();
    } catch (cause) {
      return {
        status: 'LOCAL_PERSISTENCE_ERROR',
        message: 'The enrolled device session could not be loaded locally.',
        cause,
      };
    }

    if (resolution.status === 'TRANSPORT_UNAVAILABLE') {
      return { status: 'UNAVAILABLE', message: resolution.message };
    }
    if (resolution.status === 'AUTHORITATIVELY_INVALID' || resolution.status === 'NOT_ENROLLED') {
      return { status: 'DEVICE_SESSION_INVALID', message: resolution.message };
    }
    if (resolution.status === 'PROTOCOL_ERROR') {
      return { status: 'INVALID_RESPONSE', message: resolution.message };
    }
    if (resolution.status === 'LOCAL_PERSISTENCE_ERROR') {
      return {
        status: 'LOCAL_PERSISTENCE_ERROR',
        message: resolution.message,
        cause: resolution.cause,
      };
    }
    const session = resolution.session;
    const headers = this.#sessionManager.authorizationHeadersFor(session);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#projectUrl}/functions/v1/worker-auth`, {
        method: 'POST',
        headers: {
          ...headers,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pin: normalizedPin }),
        signal: controller.signal,
      });
    } catch {
      return {
        status: 'UNAVAILABLE',
        message: 'Worker authentication backend is unavailable.',
      };
    } finally {
      clearTimeout(timeout);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = object(await response.json());
      if (parsed === null) throw new TypeError('invalid response');
      body = parsed;
    } catch {
      return {
        status: 'INVALID_RESPONSE',
        message: 'Worker authentication returned an invalid response.',
      };
    }

    if (response.ok) {
      const worker = parseWorker(body['worker'], session.shopId);
      return worker === null
        ? {
            status: 'INVALID_RESPONSE',
            message: 'Worker authentication returned an invalid response.',
          }
        : { status: 'AUTHENTICATED', worker };
    }

    const remoteError = typeof body['error'] === 'string' ? body['error'] : '';
    if (response.status === 400) {
      return { status: 'INVALID_REQUEST', message: messageForStatus(response.status) };
    }
    if (response.status === 401 && remoteError === 'invalid_pin') {
      return { status: 'REJECTED', message: 'Invalid PIN.' };
    }
    if (
      (response.status === 401 &&
        (remoteError === 'invalid_access_token' || remoteError === 'device_authentication_required')) ||
      (response.status === 403 && remoteError === 'device_not_authorized')
    ) {
      return {
        status: 'DEVICE_SESSION_INVALID',
        message: 'The enrolled device session is not authorized for worker authentication.',
      };
    }
    if (response.status === 429) {
      return { status: 'THROTTLED', message: messageForStatus(response.status) };
    }
    if (response.status >= 500) {
      return { status: 'SERVER_ERROR', message: messageForStatus(response.status) };
    }
    return {
      status: 'INVALID_RESPONSE',
      message: `Worker authentication returned HTTP ${response.status}.`,
    };
  }
}
