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

function sessionCookie(shopId = shopA): string {
  return [
    `tux_ops_shop=${shopId}`,
    `tux_ops_device=${deviceId}`,
    'tux_ops_access=opaque-access-token',
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
    server_version: serverVersion,
    updated_at: `2026-08-25T03:0${serverVersion}:00.000Z`,
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

  it('returns authoritative version 1 then 2 from successive accepted PUTs', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([remoteRow(workerA, 1)]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([remoteRow(workerA, 2)]), { status: 200 }),
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
    expect(second.body()['serverVersion']).toBe(2);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('targets worker preferences independently', async () => {
    const upstream = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([remoteRow(workerA, 3)]), { status: 200 }))
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
    }

    const firstUrl = String(upstream.mock.calls[0]?.[0]);
    const secondUrl = String(upstream.mock.calls[1]?.[0]);
    expect(firstUrl).toContain(encodeURIComponent(workerA));
    expect(secondUrl).toContain(encodeURIComponent(workerB));
  });
});
