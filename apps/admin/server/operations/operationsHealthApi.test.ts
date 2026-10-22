import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

import type { AdminSessionPrincipal, OperationsHealthResponse } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import type { AdminSessionContext } from '../adminAuthService';
import type { AdminRequest, AdminResponse } from '../http';
import { sha256Hex } from '../session';
import { createOperationsHealthRequestHandler } from './operationsHealthApi';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const CSRF = 'a'.repeat(64);
const principal: AdminSessionPrincipal = {
  employeeId: '33333333-3333-4333-8333-333333333333', businessId: '44444444-4444-4444-8444-444444444444', role: 'MANAGER', permissions: ['devices.view'], shopIds: [SHOP_ID],
};
const context = {
  principal,
  session: { id: '55555555-5555-4555-8555-555555555555', business_id: principal.businessId, employee_id: principal.employeeId, csrf_token_hash: sha256Hex(CSRF), expires_at: '2026-12-01T00:00:00.000Z', revoked_at: null, reauthenticated_at: null },
  employee: { id: principal.employeeId, business_id: principal.businessId, display_name: 'Manager', role: principal.role, pin_hash: null, active: true },
} satisfies AdminSessionContext;
const result: OperationsHealthResponse = { view: 'devices', asOf: '2026-10-22T12:00:00.000Z', devices: [] };

function request(url: string, options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): AdminRequest {
  return Object.assign(new EventEmitter(), { method: options.method ?? 'GET', url, body: options.body, headers: options.headers ?? {}, socket: { remoteAddress: '127.0.0.1' } }) as AdminRequest;
}

function response() {
  let body = '';
  const headers = new Map<string, string>();
  const res = { statusCode: 200, setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); }, end(value?: string) { body = value ?? ''; } } as unknown as ServerResponse;
  return { res: res as AdminResponse, headers, json: () => JSON.parse(body) as unknown };
}

describe('operationsHealthApi', () => {
  it('accepts strict scoped views and returns no-store data', async () => {
    const read = vi.fn(async () => result);
    const handler = createOperationsHealthRequestHandler({ createClient: () => ({}) as never, loadSession: async () => context, read });
    const output = response();
    await handler(request(`/api/admin/operations-health?view=device&shopId=${SHOP_ID}&deviceId=${DEVICE_ID}`), output.res);
    expect(output.res.statusCode).toBe(200);
    expect(output.headers.get('cache-control')).toBe('no-store');
    expect(read).toHaveBeenCalledWith({ view: 'device', shopId: SHOP_ID, deviceId: DEVICE_ID }, principal, expect.anything());
  });

  it.each([
    ['/api/admin/operations-health?view=summary&shopId=bad', 400, 'invalid_operations_health_request'],
    [`/api/admin/operations-health?view=device&shopId=${SHOP_ID}`, 400, 'invalid_operations_health_request'],
  ])('rejects invalid input for %s', async (url, status, error) => {
    const handler = createOperationsHealthRequestHandler({ createClient: () => ({}) as never, loadSession: async () => context, read: async () => result });
    const output = response();
    await handler(request(url), output.res);
    expect(output.res.statusCode).toBe(status);
    expect(output.json()).toEqual({ error });
  });

  it.each([
    [Object.assign(new Error('missing'), { name: 'AdminAuthError', code: 'session_required', status: 401 }), 401, 'session_required'],
    [Object.assign(new Error('denied'), { name: 'AdminAuthorizationError', code: 'shop_forbidden' }), 403, 'shop_forbidden'],
  ])('maps authorization failures without details', async (failure, status, error) => {
    const handler = createOperationsHealthRequestHandler({ createClient: () => ({}) as never, loadSession: async () => { throw failure; }, read: async () => result });
    const output = response();
    await handler(request(`/api/admin/operations-health?view=devices&shopId=${SHOP_ID}`), output.res);
    expect(output.res.statusCode).toBe(status);
    expect(output.json()).toEqual({ error });
  });

  it('requires same origin and CSRF before daily mutations', async () => {
    const mutate = vi.fn(async () => ({ ok: true }));
    const handler = createOperationsHealthRequestHandler({ createClient: () => ({}) as never, loadSession: async () => context, read: async () => result, mutate });
    const command = { type: 'daily.manager-note.append', shopId: SHOP_ID, note: 'Safe note', correctionOfId: null, commandId: 'note-1' };
    for (const headers of [{}, { origin: 'https://admin.local', host: 'admin.local' }]) {
      const output = response();
      await handler(request('/api/admin/operations-health', { method: 'POST', body: command, headers }), output.res);
      expect(output.res.statusCode).toBe(403);
    }
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not hide server-side permission denial behind the UI', async () => {
    const failure = Object.assign(new Error('denied'), { name: 'AdminAuthorizationError', code: 'permission_forbidden' });
    const handler = createOperationsHealthRequestHandler({ createClient: () => ({}) as never, loadSession: async () => context, read: async () => result, mutate: async () => { throw failure; } });
    const output = response();
    await handler(request('/api/admin/operations-health', { method: 'POST', body: { type: 'daily.manager-note.append', shopId: SHOP_ID, note: 'Safe note', correctionOfId: null, commandId: 'note-1' }, headers: { origin: 'https://admin.local', host: 'admin.local', 'x-tux-admin-csrf': CSRF } }), output.res);
    expect(output.res.statusCode).toBe(403);
    expect(output.json()).toEqual({ error: 'permission_forbidden' });
  });
});
