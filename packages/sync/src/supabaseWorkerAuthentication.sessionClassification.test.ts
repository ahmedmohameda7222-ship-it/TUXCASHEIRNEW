import { describe, expect, it, vi } from 'vitest';
import { parseEntityId, type ShopId } from '@tux/domain';
import {
  SupabaseDeviceSessionManager,
  type SupabaseDeviceSessionRecord,
  type SupabaseDeviceSessionStore,
} from './supabaseDeviceSession';
import { SupabaseWorkerAuthenticator } from './supabaseWorkerAuthentication';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const DEVICE_ID = '30000000-0000-4000-8000-000000000001';
const WORKER_ID = '20000000-0000-4000-8000-000000000001';

class MemoryStore implements SupabaseDeviceSessionStore {
  session: SupabaseDeviceSessionRecord | null;

  constructor(session: SupabaseDeviceSessionRecord | null) {
    this.session = session;
  }

  async load() {
    return this.session;
  }

  async save(session: SupabaseDeviceSessionRecord) {
    this.session = session;
  }
}

function expiringSession(): SupabaseDeviceSessionRecord {
  return {
    shopId: SHOP_ID,
    deviceId: DEVICE_ID,
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: 1_050,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authenticatedWorkerResponse(): Response {
  return json(200, {
    worker: {
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'pbkdf2-sha256$100000$aa$bb',
      active: true,
    },
  });
}

function manager(
  store: MemoryStore,
  fetcher: typeof fetch,
  timeoutMs = 10_000,
): SupabaseDeviceSessionManager {
  return new SupabaseDeviceSessionManager({
    projectUrl: 'https://project.supabase.co',
    publishableKey: 'publishable-key',
    store,
    fetcher,
    nowEpochSeconds: () => 1_000,
    timeoutMs,
  });
}

function authenticator(sessionManager: SupabaseDeviceSessionManager) {
  return new SupabaseWorkerAuthenticator({
    projectUrl: 'https://project.supabase.co',
    sessionManager,
    fetcher: vi.fn().mockResolvedValue(authenticatedWorkerResponse()),
  });
}

describe('desktop worker authentication device-session classification', () => {
  it('uses a still-valid local device session without refreshing it', async () => {
    const store = new MemoryStore({ ...expiringSession(), expiresAt: 2_000 });
    const refresh = vi.fn<typeof fetch>();
    const result = await authenticator(manager(store, refresh)).authenticate('1234');
    expect(result.status).toBe('AUTHENTICATED');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('continues online worker authentication after a successful token refresh', async () => {
    const store = new MemoryStore(expiringSession());
    const refresh = vi.fn<typeof fetch>().mockResolvedValue(
      json(200, {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3_600,
      }),
    );
    const result = await authenticator(manager(store, refresh)).authenticate('1234');
    expect(result.status).toBe('AUTHENTICATED');
    expect(store.session?.accessToken).toBe('new-access');
  });

  it('classifies refresh network failure as explicit unavailability', async () => {
    const store = new MemoryStore(expiringSession());
    const refresh = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network unreachable'));
    const result = await authenticator(manager(store, refresh)).authenticate('1234');
    expect(result.status).toBe('UNAVAILABLE');
  });

  it('classifies refresh timeout as explicit unavailability', async () => {
    const store = new MemoryStore(expiringSession());
    const refresh: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    const result = await authenticator(manager(store, refresh, 5)).authenticate('1234');
    expect(result.status).toBe('UNAVAILABLE');
  });

  it('does not permit offline fallback after an authoritative refresh-token rejection', async () => {
    const store = new MemoryStore(expiringSession());
    const refresh = vi.fn<typeof fetch>().mockResolvedValue(json(400, { error: 'invalid_grant' }));
    const result = await authenticator(manager(store, refresh)).authenticate('1234');
    expect(result.status).toBe('DEVICE_SESSION_INVALID');
  });

  it('does not permit offline fallback for a malformed refresh response', async () => {
    const store = new MemoryStore(expiringSession());
    const refresh = vi.fn<typeof fetch>().mockResolvedValue(json(200, { access_token: 'only-one' }));
    const result = await authenticator(manager(store, refresh)).authenticate('1234');
    expect(result.status).toBe('INVALID_RESPONSE');
  });

  it('does not permit offline fallback when the device has no local enrollment', async () => {
    const store = new MemoryStore(null);
    const result = await authenticator(manager(store, vi.fn<typeof fetch>())).authenticate('1234');
    expect(result.status).toBe('DEVICE_SESSION_INVALID');
  });
});
