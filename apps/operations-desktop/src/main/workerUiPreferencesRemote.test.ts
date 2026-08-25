import { instant, parseEntityId, type MenuCategoryId, type ShopId, type WorkerId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseDesktopWorkerUiPreferencesGateway } from './automaticSync';

const shopA = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const shopB = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111112');
const workerA = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222221');
const categoryA = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333331');
const deviceId = '44444444-4444-4444-8444-444444444444';

function remoteRow(serverVersion = 4) {
  return {
    shop_id: shopA,
    worker_id: workerA,
    category_order: [categoryA],
    category_alignment: 'center',
    server_version: serverVersion,
    updated_at: `2026-08-25T03:0${serverVersion}:00.000Z`,
  };
}

function sessionManager() {
  return {
    requiredSession: vi.fn().mockResolvedValue({
      shopId: shopA,
      deviceId,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: 2_000_000_000,
    }),
    authorizationHeaders: vi.fn().mockResolvedValue({
      apikey: 'publishable-key',
      authorization: 'Bearer access-token',
      'x-tux-device-id': deviceId,
    }),
  };
}

describe('SupabaseDesktopWorkerUiPreferencesGateway', () => {
  it('loads one worker preference through the authenticated Supabase REST table', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([remoteRow()]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const manager = sessionManager();
    const gateway = new SupabaseDesktopWorkerUiPreferencesGateway({
      projectUrl: 'https://project.supabase.co',
      sessionManager: manager,
      fetcher,
    });

    await expect(gateway.getWorkerUiPreferences(shopA, workerA)).resolves.toEqual({
      shopId: shopA,
      workerId: workerA,
      categoryOrder: [categoryA],
      categoryAlignment: 'center',
      serverVersion: 4,
      updatedAt: instant('2026-08-25T03:04:00.000Z'),
    });

    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.pathname).toBe('/rest/v1/worker_ui_preferences');
    expect(url.searchParams.get('shop_id')).toBe(`eq.${shopA}`);
    expect(url.searchParams.get('worker_id')).toBe(`eq.${workerA}`);
    expect(manager.authorizationHeaders).toHaveBeenCalledTimes(1);
  });

  it('returns null when the worker has no remote preference', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const gateway = new SupabaseDesktopWorkerUiPreferencesGateway({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher,
    });

    await expect(gateway.getWorkerUiPreferences(shopA, workerA)).resolves.toBeNull();
  });

  it('rejects cross-shop access before making a network request', async () => {
    const fetcher = vi.fn();
    const gateway = new SupabaseDesktopWorkerUiPreferencesGateway({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher,
    });

    await expect(gateway.getWorkerUiPreferences(shopB, workerA)).rejects.toThrow(
      'Device session belongs to a different shop.',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('writes through the monotonic RPC and returns the authoritative version', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(remoteRow(7)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const manager = sessionManager();
    const gateway = new SupabaseDesktopWorkerUiPreferencesGateway({
      projectUrl: 'https://project.supabase.co',
      sessionManager: manager,
      fetcher,
    });

    const result = await gateway.putWorkerUiPreferences({
      shopId: shopA,
      workerId: workerA,
      categoryOrder: [categoryA],
      categoryAlignment: 'right',
    });

    expect(result.serverVersion).toBe(7);
    expect(result.workerId).toBe(workerA);
    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe('https://project.supabase.co/rest/v1/rpc/put_worker_ui_preferences');
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
          'content-type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      p_shop_id: shopA,
      p_worker_id: workerA,
      p_category_order: [categoryA],
      p_category_alignment: 'right',
    });
  });
});
