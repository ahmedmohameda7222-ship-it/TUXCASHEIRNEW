import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import { bootstrapDeviceWithWorkerPin } from './workerPinBootstrap';

const deviceA = '22222222-2222-4222-8222-222222222221';
const deviceB = '22222222-2222-4222-8222-222222222222';
const trustedClientAddress = '203.0.113.44';

function responseCapture(): GatewayResponse {
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

function request(input: {
  readonly deviceId: string;
  readonly userAgent?: string;
  readonly deviceLabel?: string;
  readonly forwardedFor?: string;
  readonly realIp?: string;
}): GatewayRequest {
  const headers: IncomingHttpHeaders = {
    host: 'tux.test',
    origin: 'https://tux.test',
    'x-vercel-forwarded-for': trustedClientAddress,
    'x-forwarded-for': input.forwardedFor ?? trustedClientAddress,
    'x-real-ip': input.realIp ?? trustedClientAddress,
    'user-agent': input.userAgent ?? 'TUX browser',
  };
  return {
    method: 'POST',
    url: '/api/device-bootstrap',
    headers,
    body: {
      pin: '1234',
      deviceId: input.deviceId,
      deviceLabel: input.deviceLabel ?? 'TUX Operations Browser',
    },
  } as GatewayRequest;
}

function upstreamRateLimitKeys(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => {
    const init = call[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { rateLimitKey: string };
    return body.rateLimitKey;
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

describe('worker PIN bootstrap rate-limit identity', () => {
  it('keeps one abuse bucket when a caller rotates its deviceId', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', upstream);

    await bootstrapDeviceWithWorkerPin(request({ deviceId: deviceA }), responseCapture());
    await bootstrapDeviceWithWorkerPin(request({ deviceId: deviceB }), responseCapture());

    const keys = upstreamRateLimitKeys(upstream);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('does not create fresh buckets from other caller-controlled identifiers', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    vi.stubGlobal('fetch', upstream);

    await bootstrapDeviceWithWorkerPin(
      request({
        deviceId: deviceA,
        userAgent: 'Attacker-UA-A',
        deviceLabel: 'rotated-label-a',
        forwardedFor: '198.51.100.1',
        realIp: '198.51.100.2',
      }),
      responseCapture(),
    );
    await bootstrapDeviceWithWorkerPin(
      request({
        deviceId: deviceB,
        userAgent: 'Attacker-UA-B',
        deviceLabel: 'rotated-label-b',
        forwardedFor: '198.51.100.200',
        realIp: '198.51.100.201',
      }),
      responseCapture(),
    );

    const keys = upstreamRateLimitKeys(upstream);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });
});
