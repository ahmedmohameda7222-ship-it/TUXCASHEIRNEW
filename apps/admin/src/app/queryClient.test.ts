import { describe, expect, it } from 'vitest';

import { AdminApiError } from '../lib/adminApi';
import { queryClient, shouldRetryAdminQuery } from './queryClient';

describe('Admin query retry policy', () => {
  it('refreshes stale workspaces on tab focus or reconnect after external changes', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    expect(queryClient.getDefaultOptions().queries?.refetchOnReconnect).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])('does not retry HTTP %i', (status) => {
    expect(shouldRetryAdminQuery(0, new AdminApiError(status, 'rejected'))).toBe(false);
  });

  it('allows at most one retry for transient failures', () => {
    expect(shouldRetryAdminQuery(0, new AdminApiError(503, 'unavailable'))).toBe(true);
    expect(shouldRetryAdminQuery(1, new AdminApiError(503, 'unavailable'))).toBe(false);
    expect(shouldRetryAdminQuery(0, new Error('network'))).toBe(true);
    expect(shouldRetryAdminQuery(1, new Error('network'))).toBe(false);
  });
});
