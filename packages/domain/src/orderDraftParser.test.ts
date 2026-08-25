import { describe, expect, it } from 'vitest';
import { InvalidOrderDraftError, parseOrderDraft } from './orderDraftParser';

const validDraft = {
  shopId: '11111111-1111-4111-8111-111111111111',
  businessDayId: '22222222-2222-4222-8222-222222222222',
  draftScopeId: 'operations-main',
  revision: 3,
  updatedAt: '2026-08-20T00:00:00.000Z',
  checkoutIntentKey: '33333333-3333-4333-8333-333333333333',
  orderTypeId: '44444444-4444-4444-8444-444444444444',
  lines: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      productId: '66666666-6666-4666-8666-666666666666',
      productName: 'Dev Burger',
      unitPriceMinor: 12500,
      quantity: 2,
      modifiers: [
        {
          modifierId: '77777777-7777-4777-8777-777777777777',
          label: 'Cheese',
          unitPriceMinor: 1000,
          quantity: 1,
        },
      ],
      comboBeverages: [
        {
          productId: '88888888-8888-4888-8888-888888888888',
          label: 'Cola',
        },
      ],
      itemNote: 'No onions',
      addedSequence: 0,
    },
  ],
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
  payment: { mode: 'NONE' },
} as const;

const METHOD_A_ID = '99999999-9999-4999-8999-999999999991';
const METHOD_B_ID = '99999999-9999-4999-8999-999999999992';

describe('parseOrderDraft', () => {
  it('rehydrates a fully validated nested draft', () => {
    expect(parseOrderDraft(validDraft)).toEqual(validDraft);
  });

  it('parses the simplified split-payment shape', () => {
    const payment = {
      mode: 'SPLIT',
      methodAId: METHOD_A_ID,
      amountAMinor: 32_000,
      methodBId: METHOD_B_ID,
    } as const;

    expect(parseOrderDraft({ ...validDraft, payment }).payment).toEqual(payment);
  });

  it('tolerates legacy split tender keys without rehydrating them', () => {
    const parsed = parseOrderDraft({
      ...validDraft,
      payment: {
        mode: 'SPLIT',
        methodAId: METHOD_A_ID,
        amountAMinor: 32_000,
        methodACashReceivedMinor: 40_000,
        methodBId: METHOD_B_ID,
        methodBCashReceivedMinor: null,
      },
    });

    expect(parsed.payment).toEqual({
      mode: 'SPLIT',
      methodAId: METHOD_A_ID,
      amountAMinor: 32_000,
      methodBId: METHOD_B_ID,
    });
  });

  it.each([
    [{ ...validDraft, shopId: 'not-an-id' }, 'shopId'],
    [{ ...validDraft, revision: -1 }, 'revision'],
    [{ ...validDraft, checkoutIntentKey: 'not-a-uuid' }, 'checkoutIntentKey'],
    [{ ...validDraft, lines: [{ ...validDraft.lines[0], quantity: 0 }] }, 'quantity'],
    [{ ...validDraft, payment: { mode: 'UNKNOWN' } }, 'payment.mode'],
    [{ ...validDraft, delivery: { ...validDraft.delivery, finalFeeMinor: 1.5 } }, 'finalFeeMinor'],
  ])(
    'rejects malformed durable or IPC payloads before they become OrderDraft (%s)',
    (value, field) => {
      expect(() => parseOrderDraft(value)).toThrow(InvalidOrderDraftError);
      expect(() => parseOrderDraft(value)).toThrow(String(field));
    },
  );

  it('does not accept a JSON object merely because TypeScript could cast it', () => {
    expect(() => parseOrderDraft({ shopId: validDraft.shopId })).toThrow(InvalidOrderDraftError);
  });
});
