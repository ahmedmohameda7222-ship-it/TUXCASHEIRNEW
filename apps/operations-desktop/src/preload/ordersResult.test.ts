import { describe, expect, it } from 'vitest';
import { assertOrdersWorkspaceResult } from './ordersResult';

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const shopId = id('1');
const dayId = id('2');
const workerId = id('3');

function workspace(parkedDrafts?: unknown) {
  return {
    ok: true,
    value: {
      shopId,
      businessDayId: dayId,
      configuration: {
        categories: [],
        products: [],
        orderTypes: [],
        paymentMethods: [],
        deliveryZones: [],
      },
      operator: { id: workerId, displayName: 'Worker' },
      recoveryState: 'NONE',
      draft: {
        shopId,
        businessDayId: dayId,
        draftScopeId: 'orders-main',
        revision: 0,
        updatedAt: '2026-09-04T07:00:00.000Z',
        checkoutIntentKey: 'intent',
        lines: [],
        discountMinor: 0,
        delivery: {},
        payment: { mode: 'NONE' },
      },
      ...(parkedDrafts === undefined ? {} : { parkedDrafts }),
    },
  };
}

describe('Orders preload parked summaries', () => {
  it('requires the safe parkedDrafts summary array on workspace responses', () => {
    expect(() => assertOrdersWorkspaceResult(workspace())).toThrow(TypeError);
  });

  it('accepts safe parked summaries and rejects raw parked draft payloads', () => {
    expect(() =>
      assertOrdersWorkspaceResult(
        workspace([
          {
            id: 'parked-1',
            parkedAt: '2026-09-04T07:00:00.000Z',
            parkedByWorkerId: workerId,
            lineCount: 1,
            customerName: 'Alice',
            displayPhone: '+201000000000',
            totalQuantity: 2,
          },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      assertOrdersWorkspaceResult(
        workspace([
          {
            id: 'parked-1',
            parkedAt: '2026-09-04T07:00:00.000Z',
            parkedByWorkerId: workerId,
            lineCount: 1,
            customerName: 'Alice',
            displayPhone: '+201000000000',
            totalQuantity: 2,
            draft: { secret: 'raw draft must not cross preload' },
          },
        ]),
      ),
    ).toThrow(TypeError);
  });
});
