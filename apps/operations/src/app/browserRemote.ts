import type { SupabaseDeviceSessionRecord, SupabaseDeviceSessionStore } from '@tux/sync';

const REMOTE_SETTINGS_STORAGE_KEY = 'tux.operations.remote-settings.v1';
const SESSION_DATABASE_NAME = 'tux-operations-browser-auth';
const SESSION_DATABASE_VERSION = 1;
const SESSION_STORE_NAME = 'device-session';
const SESSION_KEY = 'current';

export interface BrowserRemoteSettings {
  readonly projectUrl: string;
  readonly publishableKey: string;
}

export interface BrowserRemoteSetupInput extends BrowserRemoteSettings {
  readonly enrollmentCode: string;
  readonly deviceLabel: string;
}

export interface BrowserRemoteSetupDefaults extends BrowserRemoteSettings {
  readonly deviceLabel: string;
}

function clean(value: string): string {
  return value.trim();
}

function environmentSettings(): BrowserRemoteSettings | null {
  const projectUrl = clean(import.meta.env['VITE_TUX_SUPABASE_URL'] ?? '');
  const publishableKey = clean(import.meta.env['VITE_TUX_SUPABASE_PUBLISHABLE_KEY'] ?? '');
  if (projectUrl.length === 0 || publishableKey.length === 0) return null;
  return { projectUrl, publishableKey };
}

function storedSettings(): BrowserRemoteSettings | null {
  try {
    const raw = window.localStorage.getItem(REMOTE_SETTINGS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const source = parsed as Record<string, unknown>;
    const projectUrl = typeof source['projectUrl'] === 'string' ? clean(source['projectUrl']) : '';
    const publishableKey =
      typeof source['publishableKey'] === 'string' ? clean(source['publishableKey']) : '';
    if (projectUrl.length === 0 || publishableKey.length === 0) return null;
    return { projectUrl, publishableKey };
  } catch {
    return null;
  }
}

export function loadBrowserRemoteSettings(): BrowserRemoteSettings | null {
  return environmentSettings() ?? storedSettings();
}

export function browserRemoteSetupDefaults(): BrowserRemoteSetupDefaults {
  const settings = loadBrowserRemoteSettings();
  return {
    projectUrl: settings?.projectUrl ?? '',
    publishableKey: settings?.publishableKey ?? '',
    deviceLabel: 'Browser POS',
  };
}

export function saveBrowserRemoteSettings(settings: BrowserRemoteSettings): void {
  const projectUrl = clean(settings.projectUrl);
  const publishableKey = clean(settings.publishableKey);
  if (projectUrl.length === 0 || publishableKey.length === 0) {
    throw new TypeError('Supabase project URL and publishable key are required.');
  }
  window.localStorage.setItem(
    REMOTE_SETTINGS_STORAGE_KEY,
    JSON.stringify({ projectUrl, publishableKey }),
  );
}

function requestValue<Result>(request: IDBRequest<Result>): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener(
      'error',
      () => reject(request.error ?? new Error('IndexedDB request failed.')),
      { once: true },
    );
  });
}

async function openSessionDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(SESSION_DATABASE_NAME, SESSION_DATABASE_VERSION);
  request.addEventListener(
    'upgradeneeded',
    () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE_NAME)) {
        database.createObjectStore(SESSION_STORE_NAME);
      }
    },
    { once: true },
  );
  return requestValue(request);
}

function parseStoredSession(value: unknown): SupabaseDeviceSessionRecord | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Stored browser device session is invalid.');
  }
  const source = value as Record<string, unknown>;
  const text = (key: string): string => {
    const candidate = source[key];
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      throw new TypeError(`Stored browser device session ${key} is invalid.`);
    }
    return candidate.trim();
  };
  const expiresAt = source['expiresAt'];
  if (typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new TypeError('Stored browser device session expiresAt is invalid.');
  }
  return {
    shopId: text('shopId') as SupabaseDeviceSessionRecord['shopId'],
    deviceId: text('deviceId'),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    expiresAt,
  };
}

export class BrowserIndexedDbDeviceSessionStore implements SupabaseDeviceSessionStore {
  async load(): Promise<SupabaseDeviceSessionRecord | null> {
    const database = await openSessionDatabase();
    try {
      const transaction = database.transaction(SESSION_STORE_NAME, 'readonly');
      const value = await requestValue(
        transaction.objectStore(SESSION_STORE_NAME).get(SESSION_KEY),
      );
      return parseStoredSession(value);
    } finally {
      database.close();
    }
  }

  async save(session: SupabaseDeviceSessionRecord): Promise<void> {
    const database = await openSessionDatabase();
    try {
      const transaction = database.transaction(SESSION_STORE_NAME, 'readwrite');
      await requestValue(transaction.objectStore(SESSION_STORE_NAME).put(session, SESSION_KEY));
    } finally {
      database.close();
    }
  }
}
