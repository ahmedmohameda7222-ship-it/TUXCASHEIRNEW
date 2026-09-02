import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserRemoteGateway } from './browserRemote';

const SHOP_ID = '10000000-0000-4000-8000-000000000001';
const WORKER_ID = '20000000-0000-4000-8000-000000000001';

function successfulWorker() {
  return {
    worker: {
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'pbkdf2-sha256$100000$aa$bb',
      active: true,
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { hostname: 'operations.example', origin: 'https://operations.example' },
    localStorage: {
      getItem: vi.fn().mockReturnValue('30000000-0000-4000-8000-000000000001'),
      setItem: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VercelBrowserRemoteGateway worker authentication', () => {
  it('returns the current authoritative worker on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, successfulWorker())));

    await expect(new VercelBrowserRemoteGateway().authenticateWorker('1234')).resolves.toEqual({
      status: 'AUTHENTICATED',
      worker: successfulWorker().worker,
    });
  });

  it.each([
    [400, { error: 'invalid_worker_auth_request' }, 'INVALID_REQUEST'],
    [401, { error: 'invalid_pin' }, 'REJECTED'],
    [403, { error: 'device_not_authorized' }, 'DEVICE_SESSION_INVALID'],
    [429, { error: 'too_many_pin_attempts' }, 'THROTTLED'],
    [500, { error: 'worker_lookup_failed' }, 'SERVER_ERROR'],
    [503, { error: 'worker_lookup_failed' }, 'SERVER_ERROR'],
    [502, { error: 'invalid_remote_response' }, 'INVALID_RESPONSE'],
  ] as const)(
    'maps HTTP %s without enabling offline fallback incorrectly',
    async (status, body, expectedStatus) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, body)));
      const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
      expect(result.status).toBe(expectedStatus);
    },
  );

  it('treats only the explicit proxy transport-unavailable signal as offline fallback eligible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(503, { error: 'remote_backend_unavailable' })),
    );

    await expect(new VercelBrowserRemoteGateway().authenticateWorker('1234')).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: 'Worker authentication backend is unavailable.',
    });
  });

  it('treats a network exception as genuine unavailability', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')));

    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('UNAVAILABLE');
  });

  it('treats malformed successful payloads as non-fallback errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { worker: { id: WORKER_ID } })));

    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('INVALID_RESPONSE');
  });
});
