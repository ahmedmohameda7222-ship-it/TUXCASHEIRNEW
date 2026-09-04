import { describe, expect, it } from 'vitest';
import { moneyMinor } from './money';
import { hasMeaningfulOrderDraft, type OrderDraft } from './orderDraft';
import { instant } from './time';
import { parseEntityId, type BusinessDayId, type DeliveryZoneId, type ShopId } from './ids';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const businessDayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const zoneId = parseEntityId<DeliveryZoneId>('33333333-3333-4333-8333-333333333333');

function emptyDraft(): OrderDraft {
  return {
    shopId,
    businessDayId,
    draftScopeId: 'orders-main',
    revision: 4,
    updatedAt: instant('2026-09-04T00:00:00.000Z'),
    checkoutIntentKey: '44444444-4444-4444-8444-444444444444',
    orderTypeId: null,
    lines: [],
    orderNote: null,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: { mode: 'NONE' },
  };
}

describe('hasMeaningfulOrderDraft', () => {
  it('treats null and a fresh empty draft as not meaningful', () => {
    expect(hasMeaningfulOrderDraft(null)).toBe(false);
    expect(hasMeaningfulOrderDraft(emptyDraft())).toBe(false);
  });

  it.each([
    ['order note', (draft: OrderDraft) => ({ ...draft, orderNote: 'note' })],
    ['discount', (draft: OrderDraft) => ({ ...draft, discountMinor: moneyMinor(1) })],
    [
      'payment',
      (draft: OrderDraft) => ({
        ...draft,
        payment: {
          mode: 'SINGLE' as const,
          methodId: '55555555-5555-4555-8555-555555555555' as never,
          cashReceivedMinor: null,
        },
      }),
    ],
    [
      'display phone',
      (draft: OrderDraft) => ({
        ...draft,
        delivery: { ...draft.delivery, displayPhone: '+201012345678' },
      }),
    ],
    [
      'normalized phone',
      (draft: OrderDraft) => ({
        ...draft,
        delivery: { ...draft.delivery, normalizedPhone: '01012345678' },
      }),
    ],
    [
      'customer name',
      (draft: OrderDraft) => ({
        ...draft,
        delivery: { ...draft.delivery, customerName: 'Customer' },
      }),
    ],
    [
      'address',
      (draft: OrderDraft) => ({ ...draft, delivery: { ...draft.delivery, address: '1 Street' } }),
    ],
    ['zone', (draft: OrderDraft) => ({ ...draft, delivery: { ...draft.delivery, zoneId } })],
    [
      'final delivery fee',
      (draft: OrderDraft) => ({
        ...draft,
        delivery: { ...draft.delivery, finalFeeMinor: moneyMinor(1) },
      }),
    ],
    [
      'line',
      (draft: OrderDraft) => ({
        ...draft,
        lines: [
          {
            id: '66666666-6666-4666-8666-666666666666' as never,
            productId: '77777777-7777-4777-8777-777777777777' as never,
            productName: 'Burger',
            unitPriceMinor: moneyMinor(100),
            quantity: 1,
            modifiers: [],
            comboBeverages: [],
            itemNote: null,
            addedSequence: 0,
          },
        ],
      }),
    ],
  ])('treats %s as meaningful customer work', (_label, mutate) => {
    expect(hasMeaningfulOrderDraft(mutate(emptyDraft()))).toBe(true);
  });

  it('ignores metadata-only changes', () => {
    const draft = emptyDraft();
    expect(
      hasMeaningfulOrderDraft({
        ...draft,
        orderTypeId: '88888888-8888-4888-8888-888888888888' as never,
        checkoutIntentKey: '99999999-9999-4999-8999-999999999999',
        revision: 99,
        updatedAt: instant('2026-09-04T01:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('ignores whitespace-only text fields', () => {
    const draft = emptyDraft();
    expect(
      hasMeaningfulOrderDraft({
        ...draft,
        orderNote: '   ',
        delivery: {
          ...draft.delivery,
          displayPhone: ' ',
          normalizedPhone: ' ',
          customerName: ' ',
          address: ' ',
        },
      }),
    ).toBe(false);
  });
});
