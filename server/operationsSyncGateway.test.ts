import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  proxyAuthenticatedFunction,
  type GatewayRequest,
  type GatewayResponse,
} from './supabaseGateway';

const SHOP_ID = '10000000-0000-4000-8000-000000000001';
const DEVICE_ID = '30000000-0000-4000-8000-000000000001';

function jwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ exp })}.signature`;
}

function request(body: Readonly<Record<string, unknown>>): GatewayRequest {
  const accessToken = jwt(Math.floor(Date.now() / 1_000) + 3_600);
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
  return { method: 'POST', url: '/api/operations-sync', headers, body } as GatewayRequest;
}

function responseCapture() {
  let body = '';
  const response = {
    statusCode: 200,
    setHeader() {
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
  };
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

describe('operations sync gateway', () => {
  it('proxies authenticated read-only canonical day lookup without posting an event', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ shopId: SHOP_ID, openDayId: null }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetcher);
    const req = { ...request({}), method: 'GET' } as GatewayRequest;
    const output = responseCapture();
    await proxyAuthenticatedFunction(req, output.response, 'operations-sync');
    expect(output.status()).toBe(200);
    expect(output.json()).toEqual({ shopId: SHOP_ID, openDayId: null });
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://project.supabase.co/functions/v1/operations-sync');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ 'x-tux-device-id': DEVICE_ID });
  });

  it('forwards the durable envelope with device authentication and preserves a verified receipt', async () => {
    const envelope = {
      eventId: '20000000-0000-4000-8000-000000000001',
      shopId: SHOP_ID,
      idempotencyKey: 'ORDER_PLACED:test-order',
      eventType: 'ORDER_PLACED',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'APPLIED' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const captured = responseCapture();
    await proxyAuthenticatedFunction(request(envelope), captured.response, 'operations-sync');

    expect(captured.status()).toBe(200);
    expect(captured.json()).toEqual({ status: 'APPLIED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://project.supabase.co/functions/v1/operations-sync');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      apikey: 'publishable-key',
      authorization: expect.stringMatching(/^Bearer /),
      'x-tux-device-id': DEVICE_ID,
    });
    expect(JSON.parse(String(init.body))).toEqual(envelope);
  });
});
