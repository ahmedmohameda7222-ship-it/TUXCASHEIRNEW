import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { handleWorkerUiPreferences } from './workerUiPreferencesGateway';

const shopA = '11111111-1111-4111-8111-111111111111';
const shopB = '11111111-1111-4111-8111-111111111112';
const deviceId = '22222222-2222-4222-8222-222222222222';
const workerA = '33333333-3333-4333-8333-333333333331';
const workerB = '33333333-3333-4333-8333-333333333332';
const categoryA = '44444444-4444-4444-8444-444444444441';
const productA = '55555555-5555-4555-8555-555555555551';
const productB = '55555555-5555-4555-8555-555555555552';
const customAccent = '#1E3A8A';

interface ResponseCapture {
  readonly response: GatewayResponse;
  readonly headers: Map<string, unknown>;
  body(): Readonly<Record<string, unknown>>;
}

function responseCapture(): ResponseCapture {
  const headers = new Map<string, unknown>();
  let body = '';
  const response = {
    statusCode: 200,
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
    end(chunk?: unknown) {
      body = chunk === undefined ? '' : String(chunk);
      return this;
    },
  } as unknown as GatewayResponse;
  return {
    response,
    headers,
    body: () => JSON.parse(body) as Readonly<Record<string, unknown>>,
  };
}

function jwt(expiresAt = 4_000_000_000): string {
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  return `header.${payload}.signature`;
}

function sessionCookie(shopId = shopA): string {
  return [
    `tux_ops_shop=${shopId}`,
    `tux_ops_device=${deviceId}`,
    `tux_ops_access=${jwt()}`,
    'tux_ops_refresh=opaque-refresh-token',
  ].join('; ');
}

function request(input: {
  readonly method: 'GET' | 'PUT';
  readonly url: string;
  readonly shopId?: string;
  readonly body?: unknown;
}): GatewayRequest {
  const headers: IncomingHttpHeaders = {
    host: 'tux.test',
    ...(input.method === 'PUT' ? { origin: 'https://tux.test' } : {}),
    ...(input.shopId === undefined ? {} : { cookie: sessionCookie(input.shopId) }),
  };
  return {
    method: input.method,
    url: input.url,
    headers,
    ...(input.body === undefined ? {} : { body: input.body }),
  } as GatewayRequest;
}

function remoteRow(workerId: string, serverVersion: number) {
  return {
    shop_id: shopA,
    worker_id: workerId,
    category_order: [categoryA],
    category_alignment: 'center',
    product_order: [productB, productA],
    accent_color: null,
    server_version: serverVersion,
    updated_at: `2026-08-25T03:0${serverVersion}:00.000Z`,
  };
}

function remoteRowWithAccent(workerId: string, serverVersion: number) {
  return { ...remoteRow(workerId, serverVersion), accent_color: customAccent };
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

describe('handleWorkerUiPreferences', () => {
  it('rejects requests without an enrolled device session', async () => {
    const capture = responseCapture();
    await handleWorkerUiPreferences(
      request({
        method: 'GET',
        url: `/api/worker-ui-preferences?shopId=${shopA}&workerId=${workerA}`,
      }),
      capture.response,
    );

    expect(capture.response.statusCode).toBe(401);
    expect(capture.body()).toEqual({ error: 'device_authentication_required' });
  });

  it('rejects cross-shop access before contacting Supabase', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const capture = responseCapture();
    await handleWorkerUiPreferences(
      request({
        method: 'GET',
        url: `/api/worker-ui-preferences?shopId=${shopB}&workerId=${workerA}`,
        shopId: shopA,
      }),
      capture.response,
    );

    expect(capture.response.statusCode).toBe(403);
    expect(capture.body()).toEqual({ error: 'worker_ui_preferences_cross_shop' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns not found when the worker has no remote preference', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    const capture = responseCapture();
    await handleWorkerUiPreferences(
      request({
        method: 'GET',
        url: `/api/worker-ui-preferences?shopId=${shopA}&workerId=${workerA}`,
        shopId: shopA,
      }),
      capture.response,
    );

    expect(capture.response.statusCode).toBe(404);
    expect(capture.body()).toEqual({ status: 'NOT_FOUND' });
  });

  it('returns and forwards worker-specific product ordering on accepted PUTs', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([remoteRowWithAccent(workerA, 1)]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([remoteRowWithAccent(workerA, 2)]), { status: 200 }),
      );
    vi.stubGlobal('fetch', upstream);

    const performPut = async () => {
      const capture = responseCapture();
      await handleWorkerUiPreferences(
        request({
          method: 'PUT',
          url: '/api/worker-ui-preferences',
          shopId: shopA,
          body: {
            shopId: shopA,
            workerId: workerA,
            categoryOrder: [categoryA],
            categoryAlignment: 'center',
            productOrder: [productB, productA],
            accentColor: customAccent,
          },
        }),
        capture.response,
      );
      return capture;
    };

    const first = await performPut();
    const second = await performPut();
    expect(first.response.statusCode).toBe(200);
    expect(first.body()['serverVersion']).toBe(1);
    expect(first.body()['productOrder']).toEqual([productB, productA]);
    expect(first.body()['accentColor']).toBe(customAccent);
    expect(second.body()['serverVersion']).toBe(2);
    expect(upstream).toHaveBeenCalledTimes(2);
    const firstInit = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(firstInit.body))).toEqual({
      p_shop_id: shopA,
      p_worker_id: workerA,
      p_category_order: [categoryA],
      p_category_alignment: 'center',
      p_product_order: [productB, productA],
      p_accent_color: customAccent,
    });
  });

  it('forwards null accent as TUX default', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([remoteRow(workerA, 1)]), { status: 200 }));
    vi.stubGlobal('fetch', upstream);
    const capture = responseCapture();
    await handleWorkerUiPreferences(
      request({
        method: 'PUT',
        url: '/api/worker-ui-preferences',
        shopId: shopA,
        body: {
          shopId: shopA,
          workerId: workerA,
          categoryOrder: [],
          categoryAlignment: 'left',
          productOrder: [],
          accentColor: null,
        },
      }),
      capture.response,
    );

    expect(capture.response.statusCode).toBe(200);
    const init = upstream.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))['p_accent_color']).toBeNull();
    expect(capture.body()['accentColor']).toBeNull();
  });

  it('rejects non-canonical accent colors before contacting Supabase', async () => {
    const upstream = vi.fn();
    vi.stubGlobal('fetch', upstream);
    const capture = responseCapture();
    await handleWorkerUiPreferences(
      request({
        method: 'PUT',
        url: '/api/worker-ui-preferences',
        shopId: shopA,
        body: {
          shopId: shopA,
          workerId: workerA,
          categoryOrder: [],
          categoryAlignment: 'left',
          productOrder: [],
          accentColor: '#1e3a8a',
        },
      }),
      capture.response,
    );

    expect(capture.response.statusCode).toBe(400);
    expect(capture.body()).toEqual({ error: 'invalid_worker_ui_preferences_request' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('selects product order while targeting worker preferences independently', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([remoteRowWithAccent(workerA, 3)]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify([remoteRow(workerB, 7)]), { status: 200 }),
      );
    vi.stubGlobal('fetch', upstream);

    for (const workerId of [workerA, workerB]) {
      const capture = responseCapture();
      await handleWorkerUiPreferences(
        request({
          method: 'GET',
          url: `/api/worker-ui-preferences?shopId=${shopA}&workerId=${workerId}`,
          shopId: shopA,
        }),
        capture.response,
      );
      expect(capture.body()['workerId']).toBe(workerId);
      expect(capture.body()['productOrder']).toEqual([productB, productA]);
      expect(capture.body()['accentColor']).toBe(workerId === workerA ? customAccent : null);
    }

    const firstUrl = new URL(String(upstream.mock.calls[0]?.[0]));
    const secondUrl = new URL(String(upstream.mock.calls[1]?.[0]));
    expect(firstUrl.searchParams.get('worker_id')).toBe(`eq.${workerA}`);
    expect(secondUrl.searchParams.get('worker_id')).toBe(`eq.${workerB}`);
    expect(firstUrl.searchParams.get('select')).toContain('product_order');
    expect(firstUrl.searchParams.get('select')).toContain('accent_color');
  });
});
