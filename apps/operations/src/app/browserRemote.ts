import type { InboundConfigurationProvider } from '@tux/application';
import { parseEntityId, type ShopId } from '@tux/domain';

const DEVICE_ID_STORAGE_KEY = 'tux.operations.device-id';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BrowserRemoteSession {
  readonly shopId: ShopId;
  readonly deviceId: string;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value.trim();
}

async function jsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} response must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseSession(value: Record<string, unknown>): BrowserRemoteSession {
  return {
    shopId: parseEntityId<ShopId>(requiredString(value['shopId'], 'Remote session shopId')),
    deviceId: requiredString(value['deviceId'], 'Remote session deviceId'),
  };
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

export class VercelBrowserRemoteGateway implements InboundConfigurationProvider {
  async currentSession(): Promise<BrowserRemoteSession | null> {
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
    if (!response.ok) throw new Error(`Device session request failed with HTTP ${response.status}.`);
    return parseSession(await jsonObject(response, 'Device session'));
  }

  async enroll(enrollmentCode: string): Promise<BrowserRemoteSession> {
    const response = await fetch('/api/device-enroll', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        enrollmentCode: requiredString(enrollmentCode, 'Device enrollment code'),
        deviceId: browserDeviceId(),
        deviceLabel: 'TUX Operations Web',
      }),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'The device enrollment code is invalid or no longer available.'
          : 'Could not enroll this TUX Operations device.',
      );
    }
    return parseSession(await jsonObject(response, 'Device enrollment'));
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
}
