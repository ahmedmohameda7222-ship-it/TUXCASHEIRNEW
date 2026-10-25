import { describe, expect, it } from 'vitest';

import { AdminApiError } from '../../src/lib/adminApi';
import { shouldReleaseOrdersCommandIdAfterFailure } from '../../src/orders/useOrders';

describe('Orders financial command idempotency after uncertain HTTP responses', () => {
  it('retains the original command ID for transport failures and server-side 5xx responses', () => {
    expect(shouldReleaseOrdersCommandIdAfterFailure(new Error('Failed to fetch'))).toBe(false);
    expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(502, 'admin_backend_unavailable'))).toBe(false);
    expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(503, 'service_unavailable'))).toBe(false);
    expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(504, 'gateway_timeout'))).toBe(false);
  });

  it('retains identity when timeout or rate limiting leaves the commit status uncertain', () => {
    expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(408, 'request_timeout'))).toBe(false);
    expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(429, 'rate_limited'))).toBe(false);
  });

  it('releases retained identity only after definitive client-side rejection', () => {
    for (const code of [400, 401, 403, 404, 409, 422]) {
      expect(shouldReleaseOrdersCommandIdAfterFailure(new AdminApiError(code, 'request_rejected'))).toBe(true);
    }
  });
});
