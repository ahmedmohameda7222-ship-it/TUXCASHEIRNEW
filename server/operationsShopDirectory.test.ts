import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { listOperationsLoginShops } from './operationsShopDirectory';
import operationsDeviceRoute from '../apps/operations/api/device';

const SECRET = 'test-only-operations-branch-directory-hmac-secret';
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';

function request(origin = 'https://ops.example', method = 'GET'): GatewayRequest {
  return { method, headers: { host: 'ops.example', origin } } as GatewayRequest;
}

function response(): GatewayResponse & { body?: Record<string, unknown> } {
  const capture: { body?: Record<string, unknown> } = {};
  return {
    statusCode: 200,
    get body() {
      return capture.body;
    },
    setHeader() {
      return this;
    },
    end(value?: string) {
      if (value) capture.body = JSON.parse(value) as Record<string, unknown>;
      return this;
    },
  } as unknown as GatewayResponse & { body?: Record<string, unknown> };
}

beforeEach(() => {
  process.env['TUX_SUPABASE_URL'] = 'https://example.supabase.co';
  process.env['TUX_SUPABASE_PUBLISHABLE_KEY'] = 'public-test-key';
  process.env['TUX_BOOTSTRAP_HMAC_SECRET'] = SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['TUX_SUPABASE_URL'];
  delete process.env['TUX_SUPABASE_PUBLISHABLE_KEY'];
  delete process.env['TUX_BOOTSTRAP_HMAC_SECRET'];
});

describe('Operations login branch directory', () => {
  it('routes deployed Operations GET /api/operations-shops through the consolidated device function', async () => {
    const vercel: unknown = JSON.parse(
      readFileSync(new URL('../apps/operations/vercel.json', import.meta.url), 'utf8'),
    );
    const rewrites = (vercel as { rewrites: Array<{ source: string; destination: string }> })
      .rewrites;
    expect(rewrites).toContainEqual({
      source: '/api/operations-shops',
      destination: '/api/device?route=operations-shops',
    });
    const upstream = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ shops: [{ id: A, name: 'Downtown' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', upstream);
    const routeRequest = {
      ...request(),
      url: '/api/device?route=operations-shops',
    } as GatewayRequest;
    const reply = response();
    await operationsDeviceRoute(routeRequest, reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toEqual({ shops: [{ id: A, name: 'Downtown' }] });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('returns only validated branch names and IDs through a signed BFF request', async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          shops: [
            { id: A, name: 'Downtown' },
            { id: B, name: 'Mall' },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', upstream);
    const reply = response();
    await listOperationsLoginShops(request(), reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toEqual({
      shops: [
        { id: A, name: 'Downtown' },
        { id: B, name: 'Mall' },
      ],
    });
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(init.method).toBe('GET');
    expect(headers.get('x-tux-bootstrap-signature')).toBe(
      createHmac('sha256', SECRET)
        .update(
          JSON.stringify([
            'tux-operations-shop-directory:v1',
            Number(headers.get('x-tux-bootstrap-timestamp')),
            headers.get('x-tux-bootstrap-nonce'),
          ]),
        )
        .digest('hex'),
    );
  });

  it('refuses cross-origin callers and non-GET methods before contacting Supabase', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const crossOrigin = response();
    await listOperationsLoginShops(request('https://evil.example'), crossOrigin);
    expect(crossOrigin.statusCode).toBe(403);
    const wrongMethod = response();
    await listOperationsLoginShops(request('https://ops.example', 'POST'), wrongMethod);
    expect(wrongMethod.statusCode).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects malformed upstream data instead of leaking extra fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            shops: [{ id: A, name: 'Downtown', pin_hash: 'must-not-escape' }],
          }),
          { status: 200 },
        ),
      ),
    );
    const reply = response();
    await listOperationsLoginShops(request(), reply);
    expect(reply.statusCode).toBe(200);
    expect(JSON.stringify(reply.body)).not.toContain('pin_hash');
  });

  it('fails closed when Supabase is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    const reply = response();
    await listOperationsLoginShops(request(), reply);
    expect(reply.statusCode).toBe(503);
    expect(reply.body?.error).toBe('shop_directory_unavailable');
  });
});
