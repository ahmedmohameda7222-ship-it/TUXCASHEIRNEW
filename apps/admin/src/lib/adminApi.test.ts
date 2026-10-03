import { afterEach, describe, expect, it, vi } from 'vitest';

import { adminFetch } from './adminApi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adminFetch error contracts', () => {
  it('preserves domain codes from non-2xx command-result payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: false, code: 'stale_employee' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(adminFetch('/api/admin/staff')).rejects.toMatchObject({
      status: 409,
      errorCode: 'stale_employee',
      message: 'stale_employee',
    });
  });

  it('keeps the canonical error field as the first choice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'permission_forbidden', code: 'ignored_code' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(adminFetch('/api/admin/staff')).rejects.toMatchObject({
      status: 403,
      errorCode: 'permission_forbidden',
    });
  });
});
