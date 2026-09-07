import {
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseWhatsAppOperationsRepository } from './whatsappOperationsRepository';

const shopId = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('00000000-0000-4000-8000-000000000002');
const workerId = parseEntityId<WorkerId>('00000000-0000-4000-8000-000000000003');
const deviceId = parseEntityId<DeviceId>('00000000-0000-4000-8000-000000000004');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function repository(fetchMock: ReturnType<typeof vi.fn>) {
  return new SupabaseWhatsAppOperationsRepository(
    {
      projectUrl: 'https://example.supabase.co',
      serviceRoleKey: 'test-service-role-key',
    },
    fetchMock as unknown as typeof fetch,
  );
}

describe('Task 9E notification operator authority', () => {
  it('requires one active device session and the Current Operator resolver', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ business_day_id: businessDayId, worker_id: workerId }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ business_day_id: businessDayId, worker_id: workerId }]),
      );

    await expect(
      repository(fetchMock).hasActiveNotificationOperator({ shopId, deviceId }),
    ).resolves.toBe(true);

    const sessionRequest = fetchMock.mock.calls[0];
    expect(String(sessionRequest?.[0])).toContain('/rest/v1/worker_sessions?');
    expect(String(sessionRequest?.[0])).toContain(`shop_id=eq.${shopId}`);
    expect(String(sessionRequest?.[0])).toContain(`device_id=eq.${deviceId}`);
    expect(String(sessionRequest?.[0])).toContain('ended_at=is.null');
    expect(String(sessionRequest?.[0])).toContain('limit=2');
    expect(sessionRequest?.[1]).toMatchObject({
      method: 'GET',
      headers: {
        apikey: 'test-service-role-key',
        Authorization: 'Bearer test-service-role-key',
      },
    });

    const resolverRequest = fetchMock.mock.calls[1];
    expect(String(resolverRequest?.[0])).toBe(
      'https://example.supabase.co/rest/v1/rpc/resolve_tux_whatsapp_current_operator_v1',
    );
    expect(JSON.parse(String(resolverRequest?.[1]?.body))).toEqual({
      p_shop_id: shopId,
      p_business_day_id: businessDayId,
      p_claimed_worker_id: workerId,
    });
  });

  it('fails closed when no unique active device session exists', async () => {
    for (const rows of [
      [],
      [
        { business_day_id: businessDayId, worker_id: workerId },
        { business_day_id: businessDayId, worker_id: workerId },
      ],
    ]) {
      const fetchMock = vi.fn(async () => jsonResponse(rows));
      await expect(
        repository(fetchMock).hasActiveNotificationOperator({ shopId, deviceId }),
      ).resolves.toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed when the candidate is not the server Current Operator', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ business_day_id: businessDayId, worker_id: workerId }]),
      )
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(
      repository(fetchMock).hasActiveNotificationOperator({ shopId, deviceId }),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
