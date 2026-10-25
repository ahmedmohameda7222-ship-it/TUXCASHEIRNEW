import { describe, expect, it } from 'vitest';

import { AdminApiError } from '../../src/lib/adminApi';
import { shouldReleaseOrdersCommandIdAfterFailure } from '../../src/orders/orderCommandRetryPolicy';

describe('Orders financial command idempotency after uncertain HTTP responses', () => {
  it('retains original command ID for network failures and server-side 5xx responses', () => {
    expect(shouldReleaseOrdersCommandIdAfterFailure(new Error('Failed to fetch'))).toBe(false);
    for (const code of [500, 502, 503, 504]) {
      expect(
        shouldReleaseOrdersCommandIdAfterFailure(
          new AdminApiError(code, 'admin_backend_unavailable'),
        ),
      ).toBe(false);
    }
  });

  it('retains identity when timeout or rate limiting leaves commit status uncertain', () => {
    for (const code of [408, 429]) {
      expect(
        shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(code, 'uncertain_outcome')),
      ).toBe(false);
    }
  });

  it('releases retained identity only after definitive client-side rejection', () => {
    for (const code of [400, 401, 403, 404, 409, 422]) {
      expect(
        shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(code, 'request_rejected')),
      ).toBe(true);
    }
  });
});
