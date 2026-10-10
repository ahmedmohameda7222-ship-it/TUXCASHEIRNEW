import { describe, expect, it } from 'vitest';

import { AdminApiError } from '../lib/adminApi';
import { shouldRetryAdminQuery } from './queryClient';

describe('Admin query retry policy', () => {
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
