import type {
  AuthoritativeWorkerAuthenticationResult,
  InboundConfigurationProvider,
  RemoteWorkerMenuLayout,
  RemoteWorkerUiPreferences,
  WorkerMenuLayoutRemoteGateway,
  WorkerUiPreferencesRemoteGateway,
} from '@tux/application';
import { WorkerMenuLayoutConflictError } from '@tux/application';
import {
  parseEntityId,
  parseWorkerMenuLayout,
  parseWorkerUiPreferences,
  type CategoryAlignment,
  type MenuCategoryId,
  type ProductId,
  type ProductOrderByCategory,
  type Shop,
  type ShopId,
  type SystemAccentColor,
  type Worker,
  type WorkerId,
} from '@tux/domain';

const DEVICE_ID_STORAGE_KEY = 'tux.operations.device-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BrowserRemoteSession {
  readonly shopId: ShopId;
  readonly deviceId: string;
}

export interface BrowserBootstrapResult extends BrowserRemoteSession {
  readonly shop: Shop;
  readonly worker: Worker;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value.trim();
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

async function jsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
  return object(await response.json(), `${label} response`);
}

function parseSession(value: Record<string, unknown>): BrowserRemoteSession {
  return {
    shopId: parseEntityId<ShopId>(requiredString(value['shopId'], 'Remote session shopId')),
    deviceId: requiredString(value['deviceId'], 'Remote session deviceId'),
  };
}

function parseWorker(value: Record<string, unknown>, label: string): Worker {
  const workerSource = object(value['worker'], `${label} worker`);
  if (workerSource['active'] !== true) throw new TypeError(`${label} worker is not active.`);
  return {
    id: parseEntityId<WorkerId>(requiredString(workerSource['id'], `${label} worker id`)),
    shopId: parseEntityId<ShopId>(requiredString(workerSource['shopId'], `${label} worker shopId`)),
    displayName: requiredString(workerSource['displayName'], `${label} worker name`),
    pinHash: requiredString(workerSource['pinHash'], `${label} worker PIN hash`),
    active: true,
  };
}

function parseBootstrap(value: Record<string, unknown>): BrowserBootstrapResult {
  const session = parseSession(value);
  const shopSource = object(value['shop'], 'Bootstrap shop');
  const worker = parseWorker(value, 'Bootstrap');
  const shopId = parseEntityId<ShopId>(requiredString(shopSource['id'], 'Bootstrap shop id'));
  if (shopId !== session.shopId || shopSource['active'] !== true) {
    throw new TypeError('Bootstrap shop identity is invalid.');
  }
  if (worker.shopId !== session.shopId) {
    throw new TypeError('Bootstrap worker identity is invalid.');
  }

  return {
    ...session,
    shop: {
      id: shopId,
      name: requiredString(shopSource['name'], 'Bootstrap shop name'),
      active: true,
    },
    worker,
  };
}

function parseRemoteWorkerUiPreferences(value: Record<string, unknown>): RemoteWorkerUiPreferences {
  const parsed = parseWorkerUiPreferences({ ...value, syncState: 'CLEAN' });
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

function parseRemoteWorkerMenuLayout(value: Record<string, unknown>): RemoteWorkerMenuLayout {
  const parsed = parseWorkerMenuLayout({ ...value, syncState: 'CLEAN' });
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

function isLoopbackHost(): boolean {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function browserDeviceId(): string {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim() ?? '';
    if (UUID_PATTERN.test(stored)) return stored;
  } catch {
    // Device identity can still be persisted by the HttpOnly server session cookie.
  }

  const created = crypto.randomUUID();
  try {
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  } catch {
    // The server session remains authoritative when browser storage is unavailable.
  }
  return created;
}

export class VercelBrowserRemoteGateway
  implements
    InboundConfigurationProvider,
    WorkerUiPreferencesRemoteGateway,
    WorkerMenuLayoutRemoteGateway
{
  async currentSession(): Promise<BrowserRemoteSession | null> {
    if (isLoopbackHost()) return null;

    let response: Response;
    try {
      response = await fetch('/api/device-session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
    } catch {
      return null;
    }
    if (response.status === 404 || response.status === 401 || response.status === 503) return null;
    if (!response.ok)
      throw new Error(`Device session request failed with HTTP ${response.status}.`);
    return parseSession(await jsonObject(response, 'Device session'));
  }

  async bootstrap(pin: string): Promise<BrowserBootstrapResult> {
    if (isLoopbackHost()) throw new Error('Remote worker sign-in is unavailable on localhost.');
    const response = await fetch('/api/device-bootstrap', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        pin: requiredString(pin, 'Worker PIN'),
        deviceId: browserDeviceId(),
        deviceLabel: 'TUX Operations Web',
      }),
    });
    if (!response.ok) {
      if (response.status === 401) throw new Error('Invalid PIN.');
      if (response.status === 429) {
        throw new Error('Too many PIN attempts. Wait a few minutes and try again.');
      }
      throw new Error('Could not connect this TUX Operations browser.');
    }
    return parseBootstrap(await jsonObject(response, 'Worker sign-in'));
  }

  async authenticateWorker(pin: string): Promise<AuthoritativeWorkerAuthenticationResult> {
    const normalizedPin = pin.trim();
    if (!/^\d{4,12}$/.test(normalizedPin)) {
      return { status: 'INVALID_REQUEST', message: 'Enter a valid worker PIN.' };
    }
    if (isLoopbackHost()) {
      return {
        status: 'UNAVAILABLE',
        message: 'Worker authentication backend is unavailable.',
      };
    }

    let response: Response;
    try {
      response = await fetch('/api/worker-auth', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ pin: normalizedPin }),
      });
    } catch {
      return {
        status: 'UNAVAILABLE',
        message: 'Worker authentication backend is unavailable.',
      };
    }

    let body: Record<string, unknown>;
    try {
      body = await jsonObject(response, 'Worker authentication');
    } catch {
      return {
        status: 'INVALID_RESPONSE',
        message: 'Worker authentication returned an invalid response.',
      };
    }

    if (response.ok) {
      try {
        return { status: 'AUTHENTICATED', worker: parseWorker(body, 'Worker authentication') };
      } catch {
        return {
          status: 'INVALID_RESPONSE',
          message: 'Worker authentication returned an invalid response.',
        };
      }
    }

    const remoteError = typeof body['error'] === 'string' ? body['error'] : '';
    if (
      response.status === 503 &&
      (remoteError === 'remote_backend_unavailable' || remoteError === 'device_session_unavailable')
    ) {
      return {
        status: 'UNAVAILABLE',
        message: 'Worker authentication backend is unavailable.',
      };
    }
    if (response.status === 400) {
      return { status: 'INVALID_REQUEST', message: 'Worker authentication request was rejected.' };
    }
    if (response.status === 401 && remoteError === 'invalid_pin') {
      return { status: 'REJECTED', message: 'Invalid PIN.' };
    }
    if (
      (response.status === 401 &&
        (remoteError === 'device_session_invalid' ||
          remoteError === 'device_authentication_required' ||
          remoteError === 'invalid_access_token')) ||
      (response.status === 403 && remoteError === 'device_not_authorized')
    ) {
      return {
        status: 'DEVICE_SESSION_INVALID',
        message: 'This device session is not authorized for worker authentication.',
      };
    }
    if (response.status === 429) {
      return { status: 'THROTTLED', message: 'Too many PIN attempts. Try again later.' };
    }
    if (
      response.status === 502 &&
      (remoteError === 'invalid_remote_response' || remoteError === 'device_session_protocol_error')
    ) {
      return {
        status: 'INVALID_RESPONSE',
        message: 'Worker authentication returned an invalid response.',
      };
    }
    if (response.status >= 500) {
      return { status: 'SERVER_ERROR', message: 'Worker authentication failed on the server.' };
    }
    return {
      status: 'INVALID_RESPONSE',
      message: `Worker authentication returned HTTP ${response.status}.`,
    };
  }

  async discoverVersion(shopId: ShopId): Promise<number | null> {
    const url = new URL('/api/operations-config', window.location.origin);
    url.searchParams.set('shopId', shopId);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Remote configuration request failed with HTTP ${response.status}.`);
    }
    const body = await jsonObject(response, 'Remote configuration');
    const version = body['version'];
    if (version === null) return null;
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version <= 0) {
      throw new TypeError('Remote configuration version is invalid.');
    }
    return version;
  }

  async fetchCompleteConfiguration(shopId: ShopId, version: number): Promise<unknown> {
    const url = new URL('/api/operations-config', window.location.origin);
    url.searchParams.set('shopId', shopId);
    url.searchParams.set('version', String(version));
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Remote configuration request failed with HTTP ${response.status}.`);
    }
    const body = await jsonObject(response, 'Remote configuration');
    if (body['version'] !== version) {
      throw new TypeError('Remote configuration version mismatch.');
    }
    return body['bundle'];
  }

  async getWorkerMenuLayout(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerMenuLayout | null> {
    if (isLoopbackHost()) return null;
    const url = new URL('/api/worker-menu-layout', window.location.origin);
    url.searchParams.set('shopId', shopId);
    url.searchParams.set('workerId', workerId);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Worker Menu Layout request failed with HTTP ${response.status}.`);
    }
    return parseRemoteWorkerMenuLayout(await jsonObject(response, 'Worker Menu Layout'));
  }

  async putWorkerMenuLayout(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrderByCategory: ProductOrderByCategory;
    readonly expectedLayoutVersion: number | null;
  }): Promise<RemoteWorkerMenuLayout> {
    if (isLoopbackHost())
      throw new Error('Remote Worker Menu Layout sync is unavailable on localhost.');
    const response = await fetch('/api/worker-menu-layout', {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (response.status === 409) throw new WorkerMenuLayoutConflictError();
    if (!response.ok) {
      throw new Error(`Worker Menu Layout update failed with HTTP ${response.status}.`);
    }
    return parseRemoteWorkerMenuLayout(await jsonObject(response, 'Worker Menu Layout update'));
  }

  async getWorkerUiPreferences(
    shopId: ShopId,
    workerId: WorkerId,
  ): Promise<RemoteWorkerUiPreferences | null> {
    const url = new URL('/api/worker-ui-preferences', window.location.origin);
    url.searchParams.set('shopId', shopId);
    url.searchParams.set('workerId', workerId);
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Worker preference request failed with HTTP ${response.status}.`);
    }
    return parseRemoteWorkerUiPreferences(await jsonObject(response, 'Worker preference'));
  }

  async putWorkerUiPreferences(input: {
    readonly shopId: ShopId;
    readonly workerId: WorkerId;
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
    readonly accentColor: SystemAccentColor | null;
  }): Promise<RemoteWorkerUiPreferences> {
    const response = await fetch('/api/worker-ui-preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    if (!response.ok) {
      throw new Error(`Worker preference update failed with HTTP ${response.status}.`);
    }
    return parseRemoteWorkerUiPreferences(await jsonObject(response, 'Worker preference update'));
  }
}
