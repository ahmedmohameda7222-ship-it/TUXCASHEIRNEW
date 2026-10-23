import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserRemoteGateway } from './browserRemote';

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { hostname: 'operations.example', origin: 'https://operations.example' },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('browser device-session recovery', () => {
  it.each([401, 404])('treats HTTP %s as definitively missing', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(new VercelBrowserRemoteGateway().currentSession()).resolves.toBeNull();
  });
  it('does not confuse HTTP 503 with a revoked session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(new VercelBrowserRemoteGateway().currentSession()).rejects.toThrow(
      'temporarily unavailable',
    );
  });
  it('does not confuse a network outage with a revoked session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(new VercelBrowserRemoteGateway().currentSession()).rejects.toThrow(
      'while offline',
    );
  });
});
