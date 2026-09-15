import { describe, expect, it } from 'vitest';
import { parseOrderDraft } from './orderDraftParser';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const DAY_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_TYPE_ID = '44444444-4444-4444-8444-444444444444';
const METHOD_A_ID = '55555555-5555-4555-8555-555555555551';
const METHOD_B_ID = '55555555-5555-4555-8555-555555555552';

function draft(payment: unknown) {
  return {
    shopId: SHOP_ID,
    businessDayId: DAY_ID,
    draftScopeId: 'operations-main',
    revision: 1,
    updatedAt: '2026-09-14T16:30:00.000Z',
    checkoutIntentKey: INTENT_ID,
    orderTypeId: ORDER_TYPE_ID,
    lines: [],
    orderNote: null,
    discountMinor: 0,
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: 0,
      finalFeeMinor: 0,
    },
    payment,
  };
}

describe('parseOrderDraft manual payment confirmation', () => {
  it('preserves canonical single-payment confirmation evidence and reference', () => {
    const payment = {
      mode: 'SINGLE',
      methodId: METHOD_A_ID,
      cashReceivedMinor: null,
      reference: 'AUTH-123',
      manualConfirmed: true,
    } as const;

    expect(parseOrderDraft(draft(payment)).payment).toEqual(payment);
  });

  it('preserves canonical split-payment confirmation evidence independently per leg', () => {
    const payment = {
      mode: 'SPLIT',
      methodAId: METHOD_A_ID,
      amountAMinor: 1200,
      methodBId: METHOD_B_ID,
      referenceA: 'A-REF',
      referenceB: 'B-REF',
      manualConfirmedA: true,
      manualConfirmedB: false,
    } as const;

    expect(parseOrderDraft(draft(payment)).payment).toEqual(payment);
  });
});
