import { describe, expect, it } from 'vitest';
import { parseOperationsSyncPayloadV1 } from './syncContract';

describe('End Day CASH_VARIANCE reason snapshot sync', () => {
  it('preserves the immutable configured reason snapshot on reconciliation lines', () => {
    const parsed = parseOperationsSyncPayloadV1({
      eventType: 'RECONCILIATION_RECORDED',
      version: 1,
      reconciliation: {
        id: '11111111-1111-4111-8111-111111111111',
        shopId: '22222222-2222-4222-8222-222222222222',
        businessDayId: '33333333-3333-4333-8333-333333333333',
        createdByWorkerId: '44444444-4444-4444-8444-444444444444',
        createdAt: '2026-09-04T07:20:00.000Z',
        lines: [
          {
            paymentMethod: {
              id: '55555555-5555-4555-8555-555555555555',
              label: 'Cash',
              logicType: 'CASH',
            },
            expectedMinor: 0,
            actualMinor: 100,
            differenceMinor: 100,
            varianceReason: 'Cash short',
            varianceReasonCode: {
              id: 'cash-short',
              key: 'CASH_SHORT',
              family: 'CASH_VARIANCE',
              label: 'Cash short',
              version: 3,
              scope: 'SHOP',
            },
          },
        ],
      },
    });

    expect(parsed.eventType).toBe('RECONCILIATION_RECORDED');
    if (parsed.eventType !== 'RECONCILIATION_RECORDED') throw new Error('unexpected event type');
    const line = parsed.reconciliation.lines[0] as (typeof parsed.reconciliation.lines)[number] & {
      varianceReasonCode?: unknown;
    };
    expect(line?.varianceReasonCode).toEqual({
      id: 'cash-short',
      key: 'CASH_SHORT',
      family: 'CASH_VARIANCE',
      label: 'Cash short',
      version: 3,
      scope: 'SHOP',
    });
  });
});
