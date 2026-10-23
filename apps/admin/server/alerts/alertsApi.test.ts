import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';

import type { AdminAlertsPage, AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionContext } from '../adminAuthService';
import type { AdminRequest, AdminResponse } from '../http';
import { createAlertsRequestHandler } from './alertsApi';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const principal: AdminSessionPrincipal = {
  employeeId: '22222222-2222-4222-8222-222222222222',
  businessId: '33333333-3333-4333-8333-333333333333',
  role: 'MANAGER',
  permissions: ['alerts.view'],
  shopIds: [SHOP_ID],
};
const context: AdminSessionContext = {
  principal,
  employee: {
    id: principal.employeeId,
    business_id: principal.businessId,
    display_name: 'Manager',
    role: principal.role,
    pin_hash: null,
    active: true,
  },
  session: {
    id: '44444444-4444-4444-8444-444444444444',
    business_id: principal.businessId,
    employee_id: principal.employeeId,
    csrf_token_hash: 'hash',
    expires_at: '2026-12-01T00:00:00.000Z',
    revoked_at: null,
    reauthenticated_at: null,
  },
};
const page: AdminAlertsPage = {
  rows: [],
  nextCursor: null,
  asOf: '2026-10-22T09:00:00.000Z',
  scopeLabel: 'Shop A',
  unavailableSources: [],
};

function request(url: string, headers: IncomingHttpHeaders = {}): AdminRequest {
  return Object.assign(new EventEmitter(), {
    method: 'GET',
    url,
    headers: { cookie: 'tux_admin_session=session-token', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as AdminRequest;
}

function response() {
  const headers = new Map<string, string>();
  let body = '';
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { res: res as AdminResponse, headers, json: () => JSON.parse(body) as unknown };
}

describe('alertsApi', () => {
  it('parses a strict bounded GET and returns no-store source-backed results', async () => {
    const list = vi.fn(async () => page);
    const handler = createAlertsRequestHandler({
      createClient: () => ({}) as never,
      loadSession: async () => context,
      list,
    });
    const output = response();

    await handler(
      request(
        `/api/admin/alerts?shopId=${SHOP_ID}&source=APPROVAL&severity=WARNING&state=ACTIVE&limit=50`,
      ),
      output.res,
    );

    expect(output.res.statusCode).toBe(200);
    expect(output.headers.get('cache-control')).toBe('no-store');
    expect(output.json()).toEqual(page);
    expect(list).toHaveBeenCalledWith(
      {
        shopId: SHOP_ID,
        source: 'APPROVAL',
        severity: 'WARNING',
        state: 'ACTIVE',
        limit: 50,
      },
      principal,
      expect.anything(),
    );
  });

  it.each([
    [`/api/admin/alerts?shopId=bad`, 400, 'invalid_alerts_request'],
    [`/api/admin/alerts?shopId=${SHOP_ID}&limit=51`, 400, 'invalid_alerts_request'],
  ])('rejects malformed input for %s', async (url, status, error) => {
    const output = response();
    const handler = createAlertsRequestHandler({
      createClient: () => ({}) as never,
      loadSession: async () => context,
      list: async () => page,
    });

    await handler(request(url), output.res);

    expect(output.res.statusCode).toBe(status);
    expect(output.json()).toEqual({ error });
  });

  it('maps missing sessions, forbidden shops and backend failures without leaking details', async () => {
    const cases = [
      {
        error: Object.assign(new Error('session_required'), {
          name: 'AdminAuthError',
          code: 'session_required',
          status: 401,
        }),
        status: 401,
        code: 'session_required',
      },
      {
        error: Object.assign(new Error('shop_forbidden'), {
          name: 'AdminAuthorizationError',
          code: 'shop_forbidden',
        }),
        status: 403,
        code: 'shop_forbidden',
      },
      {
        error: Object.assign(new Error('secret sql response'), {
          name: 'AdminSupabaseError',
          status: 500,
          responseBody: 'secret sql response',
        }),
        status: 502,
        code: 'admin_backend_unavailable',
      },
    ];

    for (const item of cases) {
      const output = response();
      const handler = createAlertsRequestHandler({
        createClient: () => ({}) as never,
        loadSession: async () => {
          throw item.error;
        },
        list: async () => page,
      });
      await handler(request(`/api/admin/alerts?shopId=${SHOP_ID}`), output.res);
      expect(output.res.statusCode).toBe(item.status);
      expect(output.json()).toEqual({ error: item.code });
      expect(JSON.stringify(output.json())).not.toContain('secret sql response');
    }
  });
});
