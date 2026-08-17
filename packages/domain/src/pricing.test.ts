import { describe, expect, it } from 'vitest';
import { parseEntityId, type DraftLineId, type ProductId } from './ids';
import { moneyMinor } from './money';
import type { DraftOrderLine } from './orderDraft';
import { calculateOrderPricing } from './pricing';

const LINE_ID = parseEntityId<DraftLineId>('10000000-0000-4000-8000-000000000001');
const PRODUCT_ID = parseEntityId<ProductId>('20000000-0000-4000-8000-000000000001');

function line(quantity = 2): DraftOrderLine {
  return {
    id: LINE_ID,
    productId: PRODUCT_ID,
    productName: 'Double Smash',
    unitPriceMinor: moneyMinor(16_000),
    quantity,
    modifiers: [],
    comboBeverages: [],
    itemNote: null,
    addedSequence: 1,
  };
}

describe('calculateOrderPricing', () => {
  it('discounts items only and adds Delivery Fee afterward', () => {
    expect(
      calculateOrderPricing({
        lines: [line()],
        discountMinor: moneyMinor(5_000),
        deliveryFeeMinor: moneyMinor(3_000),
      }),
    ).toEqual({
      itemsSubtotalMinor: moneyMinor(32_000),
      discountMinor: moneyMinor(5_000),
      deliveryFeeMinor: moneyMinor(3_000),
      totalMinor: moneyMinor(30_000),
    });
  });

  it('rejects discount larger than items subtotal', () => {
    expect(() =>
      calculateOrderPricing({
        lines: [line(1)],
        discountMinor: moneyMinor(16_001),
        deliveryFeeMinor: moneyMinor(3_000),
      }),
    ).toThrow('Discount cannot exceed items subtotal.');
  });
});
