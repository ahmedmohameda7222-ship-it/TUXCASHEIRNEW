import { describe, expect, it } from 'vitest';

import {
  derivePurchaseOrderStatus,
  purchaseUnitCostToBaseUnitCost,
  validatePurchaseReturnQuantity,
} from './purchasingService';

describe('purchasing service rules', () => {
  it('marks a partially received PO without pretending the remainder arrived', () => {
    expect(
      derivePurchaseOrderStatus([
        { orderedBaseMicros: 10_000, receivedBaseMicros: 9_500 },
      ]),
    ).toBe('PARTIALLY_RECEIVED');
  });

  it('marks a PO received only when every ordered line is fully received', () => {
    expect(
      derivePurchaseOrderStatus([
        { orderedBaseMicros: 10_000, receivedBaseMicros: 10_000 },
        { orderedBaseMicros: 4_000, receivedBaseMicros: 4_000 },
      ]),
    ).toBe('RECEIVED');
  });

  it('keeps an ordered PO ordered before any receipt arrives', () => {
    expect(
      derivePurchaseOrderStatus([
        { orderedBaseMicros: 10_000, receivedBaseMicros: 0 },
      ]),
    ).toBe('ORDERED');
  });

  it('converts purchase-unit price into a base-unit weighted-cost input', () => {
    expect(
      purchaseUnitCostToBaseUnitCost({
        purchaseUnitCostMinor: 12_000,
        baseMicrosPerPurchaseUnit: 4_000_000,
      }),
    ).toBe(3_000);
  });

  it('rejects a purchase return that exceeds net received quantity', () => {
    expect(() =>
      validatePurchaseReturnQuantity({
        receivedBaseMicros: 10_000,
        alreadyReturnedBaseMicros: 4_000,
        requestedReturnBaseMicros: 7_000,
      }),
    ).toThrow(/exceeds net received/i);
  });

  it('allows a return up to the remaining net received quantity', () => {
    expect(
      validatePurchaseReturnQuantity({
        receivedBaseMicros: 10_000,
        alreadyReturnedBaseMicros: 4_000,
        requestedReturnBaseMicros: 6_000,
      }),
    ).toBe(6_000);
  });
});
