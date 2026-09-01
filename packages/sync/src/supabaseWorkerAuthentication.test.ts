import { describe, expect, it, vi } from 'vitest';
import { parseEntityId, type ShopId } from '@tux/domain';
import type { SupabaseDeviceSessionRecord } from './supabaseDeviceSession';
import { SupabaseWorkerAuthenticator } from './supabaseWorkerAuthentication';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const DEVICE_ID = '30000000-0000-4000-8000-000000000001';
const WORKER_ID = '20000000-0000-4000-8000-000000000001';

const session: SupabaseDeviceSessionRecord = {
  shopId: SHOP_ID,
  deviceId: DEVICE_ID,
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 4_000_000_000,
};

function sessionManager() {
  return {
    resolveSession: vi.fn().mockResolvedValue({ status: 'VALID', session } as const),
    authorizationHeadersFor: vi.fn().mockReturnValue({
      apikey: 'publishable-key',
      authorization: 'Bearer access-token',
      'x-tux-device-id': DEVICE_ID,
    }),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SupabaseWorkerAuthenticator', () => {
  it('authenticates through the resolved device session and returns the refreshed worker credential', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json(200, {
        worker: {
          id: WORKER_ID,
          shopId: SHOP_ID,
          displayName: 'Ahmed',
          pinHash: 'pbkdf2-sha256$100000$aa$bb',
          active: true,
        },
      }),
    );
    const manager = sessionManager();
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: manager,
      fetcher,
    });

    const result = await authenticator.authenticate('1234');

    expect(result.status).toBe('AUTHENTICATED');
    expect(manager.resolveSession).toHaveBeenCalledTimes(1);
    expect(manager.authorizationHeadersFor).toHaveBeenCalledWith(session);
    expect(fetcher).toHaveBeenCalledWith(
      'https://project.supabase.co/functions/v1/worker-auth',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each([
    [400, { error: 'invalid_request' }, 'INVALID_REQUEST'],
    [401, { error: 'invalid_pin' }, 'REJECTED'],
    [401, { error: 'invalid_access_token' }, 'DEVICE_SESSION_INVALID'],
    [403, { error: 'device_not_authorized' }, 'DEVICE_SESSION_INVALID'],
    [429, { error: 'too_many_pin_attempts' }, 'THROTTLED'],
    [500, { error: 'server_error' }, 'SERVER_ERROR'],
    [503, { error: 'server_error' }, 'SERVER_ERROR'],
  ] as const)('maps HTTP %s authority response to %s', async (status, body, expected) => {
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher: vi.fn().mockResolvedValue(json(status, body)),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe(expected);
  });

  it.each([401, 403] as const)(
    'keeps unrecognized HTTP %s authority responses out of stale-PIN fallback',
    async (status) => {
      const authenticator = new SupabaseWorkerAuthenticator({
        projectUrl: 'https://project.supabase.co',
        sessionManager: sessionManager(),
        fetcher: vi.fn().mockResolvedValue(json(status, { error: 'unexpected_authority_state' })),
      });

      const result = await authenticator.authenticate('1234');
      expect(result.status).toBe('INVALID_RESPONSE');
    },
  );

  it('classifies a direct network failure as explicit unavailability', async () => {
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher: vi.fn().mockRejectedValue(new TypeError('network failed')),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe('UNAVAILABLE');
  });

  it('does not classify an invalid device session as offline unavailability', async () => {
    const manager = sessionManager();
    manager.resolveSession.mockResolvedValue({
      status: 'NOT_ENROLLED',
      message: 'This TUX Operations device is not enrolled.',
    });
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: manager,
      fetcher: vi.fn(),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe('DEVICE_SESSION_INVALID');
  });

  it('treats malformed successful payloads as invalid responses', async () => {
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher: vi.fn().mockResolvedValue(json(200, { worker: { id: WORKER_ID } })),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe('INVALID_RESPONSE');
  });
});
