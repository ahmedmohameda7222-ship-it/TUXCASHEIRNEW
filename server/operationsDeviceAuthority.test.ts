import { parseEntityId, type DeviceId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { resolveOperationsDeviceAuthority } from './operationsDeviceAuthority';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const deviceId = parseEntityId<DeviceId>('22222222-2222-4222-8222-222222222222');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function input(fetcher: typeof fetch) {
  return {
    projectUrl: 'https://example.supabase.co',
    publishableKey: 'publishable',
    accessToken: 'access-token',
    deviceId,
    fetcher,
  } as const;
}

describe('resolveOperationsDeviceAuthority', () => {
  it('derives shopId from the active RLS-visible device and active OPERATIONS_DEVICE membership', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { id: 'user-1' }))
      .mockResolvedValueOnce(json(200, [{ id: deviceId, shop_id: shopId }]))
      .mockResolvedValueOnce(json(200, [{ shop_id: shopId, role: 'OPERATIONS_DEVICE' }]));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).resolves.toEqual({
      shopId,
      deviceId,
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`/rest/v1/devices?id=eq.${deviceId}`);
    expect(String(fetcher.mock.calls[2]?.[0])).toContain(`shop_id=eq.${shopId}`);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({
        apikey: 'publishable',
        authorization: 'Bearer access-token',
        accept: 'application/json',
      });
    }
  });

  it.each([401, 403])(
    'treats authenticated-user HTTP %s as DEVICE_AUTH_INVALID',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(status, { error: 'invalid' }));
      await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({
        code: 'DEVICE_AUTH_INVALID',
      });
    },
  );

  it('rejects zero or multiple active device rows authoritatively', async () => {
    for (const rows of [
      [],
      [
        { id: deviceId, shop_id: shopId },
        { id: deviceId, shop_id: shopId },
      ],
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(200, { id: 'user-1' }))
        .mockResolvedValueOnce(json(200, rows));
      await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({
        code: 'DEVICE_AUTH_INVALID',
      });
    }
  });

  it('rejects inactive/wrong membership authority', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { id: 'user-1' }))
      .mockResolvedValueOnce(json(200, [{ id: deviceId, shop_id: shopId }]))
      .mockResolvedValueOnce(json(200, []));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({
      code: 'DEVICE_AUTH_INVALID',
    });
  });

  it('classifies transport and upstream 5xx failures as REMOTE_UNAVAILABLE', async () => {
    await expect(
      resolveOperationsDeviceAuthority(
        input(vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))),
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
    await expect(
      resolveOperationsDeviceAuthority(
        input(vi.fn<typeof fetch>().mockResolvedValueOnce(json(503, {}))),
      ),
    ).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
  });

  it('classifies malformed authority responses as REMOTE_UNAVAILABLE', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(200, {}));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({
      code: 'REMOTE_UNAVAILABLE',
    });
  });
});
