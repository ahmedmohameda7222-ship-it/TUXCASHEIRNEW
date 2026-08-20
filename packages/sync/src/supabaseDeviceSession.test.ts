import { parseEntityId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  SupabaseDeviceSessionManager,
  SupabaseInboundConfigurationProvider,
  type SupabaseDeviceSessionRecord,
  type SupabaseDeviceSessionStore,
} from './supabaseDeviceSession';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const DEVICE_ID = '90000000-0000-4000-8000-000000000001';

class MemoryStore implements SupabaseDeviceSessionStore {
  session: SupabaseDeviceSessionRecord | null = null;
  async load() {
    return this.session;
  }
  async save(session: SupabaseDeviceSessionRecord) {
    this.session = session;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SupabaseDeviceSessionManager', () => {
  it('enrolls once and persists the returned device session', async () => {
    const store = new MemoryStore();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        shopId: SHOP_ID,
        deviceId: DEVICE_ID,
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: 10_000,
      }),
    );
    const manager = new SupabaseDeviceSessionManager({
      projectUrl: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      store,
      fetcher,
      nowEpochSeconds: () => 1_000,
    });

    const session = await manager.enroll({
      enrollmentCode: 'a'.repeat(64),
      deviceId: DEVICE_ID,
      deviceLabel: 'Front POS',
    });

    expect(session.shopId).toBe(SHOP_ID);
    expect(store.session).toEqual(session);
    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>)['apikey']).toBe('sb_publishable_test');
  });

  it('refreshes an expiring session and supplies current sync headers', async () => {
    const store = new MemoryStore();
    store.session = {
      shopId: SHOP_ID,
      deviceId: DEVICE_ID,
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: 1_050,
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3_600,
      }),
    );
    const manager = new SupabaseDeviceSessionManager({
      projectUrl: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      store,
      fetcher,
      nowEpochSeconds: () => 1_000,
    });

    await expect(manager.authorizationHeaders()).resolves.toEqual({
      apikey: 'sb_publishable_test',
      authorization: 'Bearer new-access',
      'x-tux-device-id': DEVICE_ID,
    });
    expect(store.session?.refreshToken).toBe('new-refresh');
  });
});

describe('SupabaseInboundConfigurationProvider', () => {
  it('uses the enrolled JWT and device identity for version and bundle reads', async () => {
    const store = new MemoryStore();
    store.session = {
      shopId: SHOP_ID,
      deviceId: DEVICE_ID,
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 10_000,
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ version: 3 }))
      .mockResolvedValueOnce(jsonResponse({ version: 3, bundle: { snapshot: { version: 3 } } }));
    const manager = new SupabaseDeviceSessionManager({
      projectUrl: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      store,
      fetcher,
      nowEpochSeconds: () => 1_000,
    });
    const provider = new SupabaseInboundConfigurationProvider({
      projectUrl: 'https://example.supabase.co',
      session: manager,
      fetcher,
    });

    await expect(provider.discoverVersion(SHOP_ID)).resolves.toBe(3);
    await expect(provider.fetchCompleteConfiguration(SHOP_ID, 3)).resolves.toEqual({
      snapshot: { version: 3 },
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.headers).toEqual({
      apikey: 'sb_publishable_test',
      authorization: 'Bearer access-1',
      'x-tux-device-id': DEVICE_ID,
    });
  });
});
