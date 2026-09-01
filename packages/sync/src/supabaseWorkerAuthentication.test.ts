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
    requiredSession: vi.fn().mockResolvedValue(session),
    authorizationHeaders: vi.fn().mockResolvedValue({
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
  it('authenticates through the existing device session and returns the refreshed worker credential', async () => {
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
    expect(manager.authorizationHeaders).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://project.supabase.co/functions/v1/worker-auth',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each([
    [400, 'INVALID_REQUEST'],
    [401, 'REJECTED'],
    [403, 'REJECTED'],
    [429, 'THROTTLED'],
    [500, 'SERVER_ERROR'],
    [503, 'SERVER_ERROR'],
  ] as const)('maps HTTP %s to %s without offline fallback', async (status, expected) => {
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: sessionManager(),
      fetcher: vi.fn().mockResolvedValue(json(status, { error: 'upstream_error' })),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe(expected);
  });

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
    manager.requiredSession.mockRejectedValue(
      new Error('This TUX Operations device is not enrolled.'),
    );
    const authenticator = new SupabaseWorkerAuthenticator({
      projectUrl: 'https://project.supabase.co',
      sessionManager: manager,
      fetcher: vi.fn(),
    });

    const result = await authenticator.authenticate('1234');
    expect(result.status).toBe('SERVER_ERROR');
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
