import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { proxyWorkerAuthentication } from './workerAuthenticationGateway';

const SHOP_ID = '10000000-0000-4000-8000-000000000001';
const DEVICE_ID = '30000000-0000-4000-8000-000000000001';
const WORKER_ID = '40000000-0000-4000-8000-000000000001';

function jwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp })}.signature`;
}

function request(accessToken: string): GatewayRequest {
  const headers: IncomingHttpHeaders = {
    host: 'tux.test',
    origin: 'https://tux.test',
    cookie: [
      `tux_ops_access=${encodeURIComponent(accessToken)}`,
      'tux_ops_refresh=refresh-token',
      `tux_ops_shop=${SHOP_ID}`,
      `tux_ops_device=${DEVICE_ID}`,
    ].join('; '),
  };
  return {
    method: 'POST',
    url: '/api/worker-auth',
    headers,
    body: { pin: '1234' },
  } as GatewayRequest;
}

function requestWithoutAccessCookie(): GatewayRequest {
  const headers: IncomingHttpHeaders = {
    host: 'tux.test',
    origin: 'https://tux.test',
    cookie: [
      'tux_ops_refresh=refresh-token',
      `tux_ops_shop=${SHOP_ID}`,
      `tux_ops_device=${DEVICE_ID}`,
    ].join('; '),
  };
  return {
    method: 'POST',
    url: '/api/worker-auth',
    headers,
    body: { pin: '1234' },
  } as GatewayRequest;
}

function responseCapture() {
  const headers = new Map<string, unknown>();
  let body = '';
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(value?: unknown) {
      body = value === undefined ? '' : String(value);
      return this;
    },
  } as unknown as GatewayResponse;
  return {
    response,
    status: () => response.statusCode,
    json: () => JSON.parse(body) as Record<string, unknown>,
    header: (name: string) => headers.get(name.toLowerCase()),
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env['TUX_SUPABASE_URL'] = 'https://project.supabase.co';
  process.env['TUX_SUPABASE_PUBLISHABLE_KEY'] = 'publishable-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['TUX_SUPABASE_URL'];
  delete process.env['TUX_SUPABASE_PUBLISHABLE_KEY'];
});

describe('browser device-session refresh classification', () => {
  it('refreshes when the access cookie has naturally expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const refreshedAccessToken = jwt(now + 3_600);
    const authenticatedWorker = {
      id: WORKER_ID,
      shopId: SHOP_ID,
      displayName: 'Recovered Worker',
      pinHash: 'pbkdf2-sha256$100000$00$00',
      active: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(200, {
          access_token: refreshedAccessToken,
          refresh_token: 'rotated-refresh-token',
          expires_at: now + 3_600,
        }),
      )
      .mockResolvedValueOnce(json(200, { worker: authenticatedWorker }));
    vi.stubGlobal('fetch', fetchMock);

    const captured = responseCapture();
    await proxyWorkerAuthentication(requestWithoutAccessCookie(), captured.response);

    expect(captured.status()).toBe(200);
    expect(captured.json()).toEqual({ worker: authenticatedWorker });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [refreshUrl, refreshInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refreshUrl).toBe(
      'https://project.supabase.co/auth/v1/token?grant_type=refresh_token',
    );
    expect(JSON.parse(String(refreshInit.body))).toEqual({ refresh_token: 'refresh-token' });

    const setCookie = captured.header('set-cookie');
    expect(setCookie).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`tux_ops_access=${encodeURIComponent(refreshedAccessToken)}`),
        expect.stringContaining('tux_ops_refresh=rotated-refresh-token'),
      ]),
    );

    const [workerAuthUrl, workerAuthInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(workerAuthUrl).toBe('https://project.supabase.co/functions/v1/worker-auth');
    expect(workerAuthInit.headers).toMatchObject({
      authorization: `Bearer ${refreshedAccessToken}`,
      'x-tux-device-id': DEVICE_ID,
    });
  });

  it('returns explicit unavailability without clearing cookies when refresh transport is offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unreachable')));
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 60)),
      captured.response,
    );
    expect(captured.status()).toBe(503);
    expect(captured.json()).toEqual({ error: 'device_session_unavailable' });
    expect(captured.header('set-cookie')).toBeUndefined();
  });

  it('returns explicit unavailability without clearing cookies when refresh times out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'TimeoutError')));
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 60)),
      captured.response,
    );
    expect(captured.status()).toBe(503);
    expect(captured.json()).toEqual({ error: 'device_session_unavailable' });
    expect(captured.header('set-cookie')).toBeUndefined();
  });

  it('clears cookies only when the refresh token is authoritatively rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'invalid_grant' })));
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 60)),
      captured.response,
    );
    expect(captured.status()).toBe(401);
    expect(captured.json()).toEqual({ error: 'device_session_invalid' });
    expect(captured.header('set-cookie')).toBeDefined();
  });

  it('treats a malformed refresh response as protocol failure without destroying durable cookies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { access_token: 'partial' })));
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 60)),
      captured.response,
    );
    expect(captured.status()).toBe(502);
    expect(captured.json()).toEqual({ error: 'device_session_protocol_error' });
    expect(captured.header('set-cookie')).toBeUndefined();
  });

  it('preserves actual authoritative invalid-worker-PIN semantics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'invalid_pin' })));
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 3_600)),
      captured.response,
    );
    expect(captured.status()).toBe(401);
    expect(captured.json()).toEqual({ error: 'invalid_pin' });
  });

  it('preserves device-not-authorized semantics from worker auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(403, { error: 'device_not_authorized' })),
    );
    const captured = responseCapture();
    await proxyWorkerAuthentication(
      request(jwt(Math.floor(Date.now() / 1000) + 3_600)),
      captured.response,
    );
    expect(captured.status()).toBe(403);
    expect(captured.json()).toEqual({ error: 'device_not_authorized' });
  });
});
