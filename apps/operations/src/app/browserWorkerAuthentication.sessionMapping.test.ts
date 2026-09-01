import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserRemoteGateway } from './browserRemote';

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

describe('browser worker-auth semantic mapping', () => {
  it.each([
    [401, { error: 'device_session_invalid' }],
    [401, { error: 'device_authentication_required' }],
    [403, { error: 'device_not_authorized' }],
  ] as const)('maps HTTP %s device/session rejection without fencing the worker PIN', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, body)));
    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('DEVICE_SESSION_INVALID');
  });

  it('maps device-session refresh transport outage to offline-eligible unavailability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(503, { error: 'device_session_unavailable' })),
    );
    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('UNAVAILABLE');
  });

  it('maps only an actual invalid worker PIN to worker rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'invalid_pin' })));
    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('REJECTED');
  });

  it('keeps malformed refresh/upstream protocol state out of offline fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(502, { error: 'device_session_protocol_error' })),
    );
    const result = await new VercelBrowserRemoteGateway().authenticateWorker('1234');
    expect(result.status).toBe('INVALID_RESPONSE');
  });
});
