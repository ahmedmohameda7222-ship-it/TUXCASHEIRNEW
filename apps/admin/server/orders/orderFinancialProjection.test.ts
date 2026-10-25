import { describe, expect, it } from 'vitest';

import {
  effectiveFinancialState,
  projectPaymentRefundBalances,
  projectReturnQuantities,
} from './orderFinancialProjection';

describe('Orders financial projections', () => {
  it.each([
    ['PENDING_APPROVAL', 'PENDING', 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', 'APPROVED', 'APPROVED'],
    ['PENDING_APPROVAL', 'EXECUTING', 'EXECUTING'],
    ['PENDING_APPROVAL', 'EXECUTED', 'EXECUTING'],
    ['PENDING_APPROVAL', 'REJECTED', 'REJECTED'],
    ['PENDING_APPROVAL', 'FAILED', 'FAILED'],
    ['POSTED', 'EXECUTED', 'POSTED'],
    ['REJECTED', 'PENDING', 'REJECTED'],
    ['FAILED', 'EXECUTED', 'FAILED'],
  ] as const)('projects %s with approval %s as %s', (record, approval, expected) => {
    expect(effectiveFinancialState(record, approval)).toBe(expected);
  });

  it('reserves pending and approved refunds, releases rejected balances and ignores returns', () => {
    const balances = projectPaymentRefundBalances(
      [{ id: 'p1', allocatedMinor: 10000, refundAllowedSnapshot: true }],
      [
        { paymentId: 'p1', amountMinor: 2500, state: 'POSTED' },
        { paymentId: 'p1', amountMinor: 2000, state: 'PENDING_APPROVAL' },
        { paymentId: 'p1', amountMinor: 1000, state: 'APPROVED' },
        { paymentId: 'p1', amountMinor: 1000, state: 'REJECTED' },
      ],
    );
    expect(balances.get('p1')).toEqual({
      postedRefundMinor: 2500,
      pendingRefundMinor: 3000,
      remainingRefundableMinor: 4500,
    });
  });

  it('returns zero available capacity for nonrefundable methods', () => {
    expect(
      projectPaymentRefundBalances(
        [{ id: 'p1', allocatedMinor: 10000, refundAllowedSnapshot: false }],
        [],
      ).get('p1')?.remainingRefundableMinor,
    ).toBe(0);
  });

  it('subtracts posted and pending return item quantities and releases rejected requests', () => {
    const quantities = projectReturnQuantities(
      [{ id: 'i1', quantity: 5 }],
      [
        { orderItemId: 'i1', quantity: 1, state: 'POSTED' },
        { orderItemId: 'i1', quantity: 2, state: 'APPROVED' },
        { orderItemId: 'i1', quantity: 1, state: 'REJECTED' },
      ],
    );
    expect(quantities.get('i1')).toEqual({
      postedReturnQuantity: 1,
      pendingReturnQuantity: 2,
      remainingReturnableQuantity: 2,
    });
  });
});
