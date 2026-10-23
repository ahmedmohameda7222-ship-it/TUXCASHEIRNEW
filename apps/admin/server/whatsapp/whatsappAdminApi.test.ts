import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionContext } from '../adminAuthService';
import type { AdminRequest, AdminResponse } from '../http';
import { createWhatsAppAdminRequestHandler } from './whatsappAdminApi';

const SHOP = '11111111-1111-4111-8111-111111111111';
const CSRF = 'a'.repeat(64);
const context: AdminSessionContext = {
  principal: {
    employeeId: '22222222-2222-4222-8222-222222222222',
    businessId: '33333333-3333-4333-8333-333333333333',
    role: 'OWNER',
    permissions: ['whatsapp.view', 'whatsapp.manage'],
    shopIds: [SHOP],
  } satisfies AdminSessionPrincipal,
  employee: {
    id: '22222222-2222-4222-8222-222222222222',
    business_id: '33333333-3333-4333-8333-333333333333',
    display_name: 'Owner',
    role: 'OWNER',
    pin_hash: null,
    active: true,
  },
  session: {
    id: '44444444-4444-4444-8444-444444444444',
    business_id: '33333333-3333-4333-8333-333333333333',
    employee_id: '22222222-2222-4222-8222-222222222222',
    csrf_token_hash: createHash('sha256').update(CSRF).digest('hex'),
    expires_at: '2026-12-01T00:00:00Z',
    revoked_at: null,
    reauthenticated_at: null,
  },
};

function request(method: string, url: string, body?: unknown, csrf?: string): AdminRequest {
  return Object.assign(new EventEmitter(), {
    method,
    url,
    body,
    headers: {
      cookie: 'tux_admin_session=x',
      origin: 'http://admin.local',
      host: 'admin.local',
      ...(csrf ? { 'x-tux-admin-csrf': csrf } : {}),
    },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as AdminRequest;
}
function response() {
  let body = '';
  const res = {
    statusCode: 200,
    setHeader() {},
    end(chunk?: string) {
      body = chunk ?? '';
    },
  } as unknown as ServerResponse;
  return { res: res as AdminResponse, json: () => JSON.parse(body) };
}
const overview = {
  view: 'overview',
  shopId: SHOP,
  canManage: true,
  configured: false,
  automationEnabled: false,
  health: 'UNKNOWN',
  recentActivityAt: null,
  totals: { conversations: 0, failed: 0, uncertain: 0, approvedTemplates: 0 },
} as const;

describe('whatsappAdminApi', () => {
  it('parses bounded reads and rejects unknown query fields', async () => {
    const read = vi.fn(async () => overview);
    const handler = createWhatsAppAdminRequestHandler({
      createClient: () => ({}) as never,
      loadSession: async () => context,
      read,
      mutate: async () => ({ ok: true, code: 'updated' }),
    });
    const ok = response();
    await handler(request('GET', `/api/admin/whatsapp?view=overview&shopId=${SHOP}`), ok.res);
    expect(ok.res.statusCode).toBe(200);
    expect(read).toHaveBeenCalled();
    const bad = response();
    await handler(
      request('GET', `/api/admin/whatsapp?view=overview&shopId=${SHOP}&secret=x`),
      bad.res,
    );
    expect(bad.res.statusCode).toBe(400);
  });
  it('denies same-origin mutations without CSRF', async () => {
    const mutate = vi.fn(async () => ({ ok: true, code: 'updated' }));
    const handler = createWhatsAppAdminRequestHandler({
      createClient: () => ({}) as never,
      loadSession: async () => context,
      read: async () => overview,
      mutate,
    });
    const out = response();
    await handler(
      request('POST', '/api/admin/whatsapp', {
        type: 'preferences.update',
        shopId: SHOP,
        commandId: 'c1',
        expectedVersion: 1,
        payload: { automationEnabled: false },
      }),
      out.res,
    );
    expect(out.res.statusCode).toBe(403);
    expect(mutate).not.toHaveBeenCalled();
  });
  it('maps stale CAS to 409 after valid CSRF', async () => {
    const handler = createWhatsAppAdminRequestHandler({
      createClient: () => ({}) as never,
      loadSession: async () => context,
      read: async () => overview,
      mutate: async () => ({ ok: false, code: 'stale_version' }),
    });
    const out = response();
    await handler(
      request(
        'POST',
        '/api/admin/whatsapp',
        {
          type: 'preferences.update',
          shopId: SHOP,
          commandId: 'c2',
          expectedVersion: 1,
          payload: { automationEnabled: false },
        },
        CSRF,
      ),
      out.res,
    );
    expect(out.res.statusCode).toBe(409);
    expect(out.json()).toEqual({ error: 'stale_version' });
  });
});
