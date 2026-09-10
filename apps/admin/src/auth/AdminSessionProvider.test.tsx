import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AdminSessionResponse } from '@tux/admin-contracts';
import { loadAdminSessionBootstrap } from './AdminSessionProvider';
import { routeIsPermitted } from '../app/routes';

const managerSession: AdminSessionResponse = {
  principal: {
    employeeId: 'employee-1',
    businessId: 'business-1',
    role: 'MANAGER',
    permissions: ['orders.view', 'inventory.view'],
    shopIds: ['shop-a'],
  },
  csrfToken: 'a'.repeat(64),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Admin session bootstrap', () => {
  it('classifies a 401 session response as unauthenticated', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'session_required' }), { status: 401 })));
    await expect(loadAdminSessionBootstrap()).resolves.toEqual({ status: 'unauthenticated' });
  });

  it('loads the server session exactly once and keeps CSRF in memory state', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(managerSession), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const state = await loadAdminSessionBootstrap();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/session', expect.objectContaining({ credentials: 'same-origin' }));
    expect(state).toEqual({ status: 'authenticated', session: managerSession });
  });

  it('exposes only routes backed by the resolved principal permission set', () => {
    expect(routeIsPermitted(managerSession.principal, '/orders')).toBe(true);
    expect(routeIsPermitted(managerSession.principal, '/inventory')).toBe(true);
    expect(routeIsPermitted(managerSession.principal, '/finance')).toBe(false);
  });
});
