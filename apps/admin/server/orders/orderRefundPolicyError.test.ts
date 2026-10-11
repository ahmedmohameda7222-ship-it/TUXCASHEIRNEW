import { describe, expect, it } from 'vitest';

import { classifyOrderRefundDatabaseError } from '../../api/admin/orders';

describe('order refund database policy errors', () => {
  it('exposes the trusted immutable-refund policy denial as a stable domain error', () => {
    expect(
      classifyOrderRefundDatabaseError(
        '{"code":"23514","message":"TUX_ADMIN_PAYMENT_REFUND_NOT_ALLOWED"}',
      ),
    ).toEqual({ status: 409, error: 'payment_refund_not_allowed' });
  });

  it('never classifies unrelated database failures as refund-policy denials', () => {
    expect(classifyOrderRefundDatabaseError('unexpected database request failure')).toBeNull();
    expect(
      classifyOrderRefundDatabaseError(
        '{"code":"23514","message":"TUX_ADMIN_PAYMENT_POLICY_SNAPSHOT_IMMUTABLE"}',
      ),
    ).toBeNull();
  });
});
