import { describe, expect, it, vi } from 'vitest';
import { SupabaseDesktopOnlineOrderOperationsRemote } from './onlineOrderOperationsRemote';

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SupabaseDesktopOnlineOrderOperationsRemote', () => {
  it('uses the main-process device session for list and review mutations', async () => {
    const authorizationHeaders = vi.fn().mockResolvedValue({
      authorization: 'Bearer device-token',
      apikey: 'publishable-key',
      'x-tux-device-id': '11111111-1111-4111-8111-111111111111',
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: 1, requests: [] }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: 1, requestId: REQUEST_ID }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: 1, requestId: REQUEST_ID }))
      .mockResolvedValueOnce(jsonResponse({ schemaVersion: 1, requestId: REQUEST_ID }));
    const remote = new SupabaseDesktopOnlineOrderOperationsRemote({
      projectUrl: 'https://project.supabase.co/',
      sessionManager: { authorizationHeaders },
      fetcher,
    });

    await remote.fetchActiveRequests(200);
    await remote.claim(REQUEST_ID);
    await remote.release(REQUEST_ID, PROCESSING_ORDER_ID);
    await remote.reject(REQUEST_ID, 'Out of service area');

    expect(authorizationHeaders).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls).toEqual([
      [
        'https://project.supabase.co/functions/v1/online-order-operations?limit=200',
        {
          method: 'GET',
          headers: {
            authorization: 'Bearer device-token',
            apikey: 'publishable-key',
            'x-tux-device-id': '11111111-1111-4111-8111-111111111111',
            accept: 'application/json',
          },
          signal: expect.any(AbortSignal),
        },
      ],
      [
        'https://project.supabase.co/functions/v1/online-order-operations',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer device-token',
            apikey: 'publishable-key',
            'x-tux-device-id': '11111111-1111-4111-8111-111111111111',
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'CLAIM', requestId: REQUEST_ID }),
          signal: expect.any(AbortSignal),
        },
      ],
      [
        'https://project.supabase.co/functions/v1/online-order-operations',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer device-token',
            apikey: 'publishable-key',
            'x-tux-device-id': '11111111-1111-4111-8111-111111111111',
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'RELEASE',
            requestId: REQUEST_ID,
            processingOrderId: PROCESSING_ORDER_ID,
          }),
          signal: expect.any(AbortSignal),
        },
      ],
      [
        'https://project.supabase.co/functions/v1/online-order-operations',
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer device-token',
            apikey: 'publishable-key',
            'x-tux-device-id': '11111111-1111-4111-8111-111111111111',
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            action: 'REJECT',
            requestId: REQUEST_ID,
            reason: 'Out of service area',
          }),
          signal: expect.any(AbortSignal),
        },
      ],
    ]);
  });

  it('rejects non-HTTPS project origins and surfaces non-success responses', async () => {
    expect(
      () =>
        new SupabaseDesktopOnlineOrderOperationsRemote({
          projectUrl: 'http://project.supabase.co',
          sessionManager: { authorizationHeaders: vi.fn() },
        }),
    ).toThrow(/HTTPS/i);

    const remote = new SupabaseDesktopOnlineOrderOperationsRemote({
      projectUrl: 'https://project.supabase.co',
      sessionManager: { authorizationHeaders: vi.fn().mockResolvedValue({}) },
      fetcher: vi.fn().mockResolvedValue(jsonResponse({ error: 'denied' }, 403)),
    });
    await expect(remote.fetchActiveRequests(200)).rejects.toThrow(/HTTP 403/i);
  });
});
