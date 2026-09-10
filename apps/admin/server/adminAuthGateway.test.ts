import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAdminReauth, type AdminRequest, type AdminResponse } from './adminAuthGateway';
import { hashPin } from './pin';
import { deriveAdminCsrfToken, sha256Hex } from './session';

const sessionToken = 'ab'.repeat(32);
const csrfToken = deriveAdminCsrfToken(sessionToken);
let pinHash = '';
let previousEnv: Record<string, string | undefined> = {};

type FetchState = {
  rateAllowed: boolean;
  retryAfterSeconds?: number;
  calls: Array<{ path: string; method: string }>;
};

function request(pin: string): AdminRequest {
  return {
    method: 'POST',
    headers: {
      origin: 'https://admin.tux.example',
      host: 'admin.tux.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.10',
      'user-agent': 'admin-gateway-test',
      cookie: `tux_admin_session=${sessionToken}`,
      'x-tux-admin-csrf': csrfToken,
    },
    body: { pin },
  } as unknown as AdminRequest;
}

function responseCapture(): {
  response: AdminResponse;
  status: () => number;
  body: () => Record<string, unknown>;
  header: (name: string) => string | undefined;
} {
  let statusCode = 200;
  let rawBody = '';
  const headers = new Map<string, string>();
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(',') : String(value));
      return response;
    },
    end(value?: unknown) {
      rawBody = value === undefined ? '' : String(value);
      return response;
    },
  } as unknown as AdminResponse;
  return {
    response,
    status: () => statusCode,
    body: () => JSON.parse(rawBody) as Record<string, unknown>,
    header: (name) => headers.get(name.toLowerCase()),
  };
}

function installSupabaseFake(state: FetchState): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(rawUrl);
      const method = init?.method ?? 'GET';
      state.calls.push({ path: `${url.pathname}${url.search}`, method });

      if (url.pathname.endsWith('/rest/v1/admin_sessions') && method === 'GET') {
        return Response.json([
          {
            id: 'session-1',
            business_id: 'business-1',
            employee_id: 'employee-1',
            csrf_token_hash: sha256Hex(csrfToken),
            expires_at: '2099-01-01T00:00:00.000Z',
            revoked_at: null,
            reauthenticated_at: null,
          },
        ]);
      }
      if (url.pathname.endsWith('/rest/v1/business_employees') && method === 'GET') {
        return Response.json([
          {
            id: 'employee-1',
            business_id: 'business-1',
            display_name: 'Owner',
            role: 'OWNER',
            pin_hash: pinHash,
            active: true,
          },
        ]);
      }
      if (url.pathname.endsWith('/rest/v1/business_shops') && method === 'GET') {
        return Response.json([{ shop_id: 'shop-1' }]);
      }
      if (url.pathname.endsWith('/rest/v1/rpc/claim_tux_admin_pin_attempt')) {
        return Response.json([
          {
            allowed: state.rateAllowed,
            retry_after_seconds: state.retryAfterSeconds ?? 0,
          },
        ]);
      }
      if (url.pathname.endsWith('/rest/v1/rpc/clear_tux_admin_pin_attempts')) {
        return Response.json(null);
      }
      if (url.pathname.endsWith('/rest/v1/admin_sessions') && method === 'PATCH') {
        return Response.json([]);
      }
      return Response.json({ error: 'unexpected_fake_request' }, { status: 500 });
    }),
  );
}

beforeEach(async () => {
  pinHash = await hashPin('482731');
  previousEnv = {
    TUX_SUPABASE_URL: process.env['TUX_SUPABASE_URL'],
    TUX_SUPABASE_SERVICE_ROLE_KEY: process.env['TUX_SUPABASE_SERVICE_ROLE_KEY'],
    TUX_ADMIN_PIN_LOOKUP_SECRET: process.env['TUX_ADMIN_PIN_LOOKUP_SECRET'],
    TUX_ADMIN_RATE_LIMIT_SECRET: process.env['TUX_ADMIN_RATE_LIMIT_SECRET'],
  };
  process.env['TUX_SUPABASE_URL'] = 'https://example.supabase.co';
  process.env['TUX_SUPABASE_SERVICE_ROLE_KEY'] = 'test-service-role-key-0123456789';
  process.env['TUX_ADMIN_PIN_LOOKUP_SECRET'] = 'test-pin-lookup-secret-0123456789';
  process.env['TUX_ADMIN_RATE_LIMIT_SECRET'] = 'test-rate-limit-secret-0123456789';
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Admin reauthentication HTTP boundary', () => {
  it('returns 401 for a wrong PIN and does not mark or clear reauthentication state', async () => {
    const state: FetchState = { rateAllowed: true, calls: [] };
    installSupabaseFake(state);
    const capture = responseCapture();

    await handleAdminReauth(request('482732'), capture.response);

    expect(capture.status()).toBe(401);
    expect(capture.body()).toEqual({ error: 'invalid_pin' });
    expect(state.calls.some((call) => call.path.includes('claim_tux_admin_pin_attempt'))).toBe(true);
    expect(state.calls.some((call) => call.method === 'PATCH')).toBe(false);
    expect(state.calls.some((call) => call.path.includes('clear_tux_admin_pin_attempts'))).toBe(false);
  });

  it('returns 429 with Retry-After before PIN verification when the shared throttle denies', async () => {
    const state: FetchState = { rateAllowed: false, retryAfterSeconds: 321, calls: [] };
    installSupabaseFake(state);
    const capture = responseCapture();

    await handleAdminReauth(request('482731'), capture.response);

    expect(capture.status()).toBe(429);
    expect(capture.body()).toEqual({ error: 'too_many_pin_attempts' });
    expect(capture.header('retry-after')).toBe('321');
    expect(state.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('marks reauthentication and clears the throttle only after a correct PIN', async () => {
    const state: FetchState = { rateAllowed: true, calls: [] };
    installSupabaseFake(state);
    const capture = responseCapture();

    await handleAdminReauth(request('482731'), capture.response);

    expect(capture.status()).toBe(200);
    expect(capture.body()['ok']).toBe(true);
    expect(state.calls.some((call) => call.method === 'PATCH')).toBe(true);
    expect(state.calls.some((call) => call.path.includes('clear_tux_admin_pin_attempts'))).toBe(true);
  });
});
