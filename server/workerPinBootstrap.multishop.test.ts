import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { bootstrapDeviceWithWorkerPin } from './workerPinBootstrap';
import { VercelBrowserRemoteGateway } from '../apps/operations/src/app/browserRemote';

const SHOP_A = '10000000-0000-4000-8000-000000000001';
const SHOP_B = '10000000-0000-4000-8000-000000000002';
const DEVICE = '20000000-0000-4000-8000-000000000001';
const SECRET = 'test-long-term-multishop-bootstrap-signing-secret';

function request(shopId: string): GatewayRequest {
  return {
    method: 'POST',
    url: '/api/device-bootstrap',
    headers: {
      host: 'ops.example',
      origin: 'https://ops.example',
      'x-vercel-forwarded-for': '203.0.113.33',
    },
    body: { pin: '1234', deviceId: DEVICE, deviceLabel: 'Operations Browser', shopId },
  } as unknown as GatewayRequest;
}

function response(): GatewayResponse {
  return {
    statusCode: 200,
    setHeader() {
      return this;
    },
    end() {
      return this;
    },
  } as unknown as GatewayResponse;
}

beforeEach(() => {
  process.env['TUX_SUPABASE_URL'] = 'https://example.supabase.co';
  process.env['TUX_SUPABASE_PUBLISHABLE_KEY'] = 'mock-public-key';
  process.env['TUX_BOOTSTRAP_HMAC_SECRET'] = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['TUX_SUPABASE_URL'];
  delete process.env['TUX_SUPABASE_PUBLISHABLE_KEY'];
  delete process.env['TUX_BOOTSTRAP_HMAC_SECRET'];
});

describe('shop-explicit first-browser bootstrap', () => {
  it('forwards and cryptographically binds the selected shop in v2 trusted proof', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', upstream);
    await bootstrapDeviceWithWorkerPin(request(SHOP_A), response());
    expect(upstream).toHaveBeenCalledTimes(1);
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    const headers = new Headers(init.headers);
    expect(body.shopId).toBe(SHOP_A);
    expect(headers.get('x-tux-bootstrap-signature')).toBe(
      createHmac('sha256', SECRET)
        .update(
          JSON.stringify([
            'tux-device-bootstrap:v2',
            Number(headers.get('x-tux-bootstrap-timestamp')),
            headers.get('x-tux-bootstrap-nonce'),
            body.rateLimitKey,
            DEVICE,
            body.deviceLabel,
            '1234',
            SHOP_A,
          ]),
        )
        .digest('hex'),
    );
  });

  it('rejects malformed shop IDs before contacting Supabase', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const reply = response();
    await bootstrapDeviceWithWorkerPin(request('another-tenant'), reply);
    expect(reply.statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('sends the shop selected by the operator from the browser', async () => {
    vi.stubGlobal('window', {
      location: { hostname: 'ops.example', origin: 'https://ops.example' },
      localStorage: { getItem: () => DEVICE, setItem: vi.fn() },
    });
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'device_bootstrap_failed' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', upstream);
    await expect(new VercelBrowserRemoteGateway().bootstrap('1234', SHOP_B)).rejects.toThrow();
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, string>;
    expect(body.shopId).toBe(SHOP_B);
  });
});
