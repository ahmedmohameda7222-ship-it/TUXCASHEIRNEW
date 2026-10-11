import { describe, expect, it } from 'vitest';

import {
  calculatePurchaseOrderSubtotalMinor,
  parsePurchaseDecimalMicros,
  parsePurchaseMoneyMinor,
  validatePurchaseOrderLines,
} from './purchaseOrderDraft';

describe('multi-line purchase-order drafting', () => {
  it('parses canonical quantities and EGP minor units without floating point rounding', () => {
    expect(parsePurchaseDecimalMicros('2.000001')).toBe(2_000_001);
    expect(parsePurchaseDecimalMicros('0.0000001')).toBeNull();
    expect(parsePurchaseDecimalMicros('0')).toBeNull();
    expect(parsePurchaseMoneyMinor('19.99')).toBe(1999);
    expect(parsePurchaseMoneyMinor('0.001')).toBeNull();
    expect(parsePurchaseMoneyMinor('-1')).toBeNull();
  });

  it('accepts multiple valid items and computes subtotal using exact integer arithmetic', () => {
    const lines = [
      { inventoryItemId: 'first', purchaseUnitLabel: 'case', orderedPurchaseUnitsMicros: 2_000_000, expectedPurchaseUnitCostMinor: 1_999 },
      { inventoryItemId: 'second', purchaseUnitLabel: 'kg', orderedPurchaseUnitsMicros: 1_500_000, expectedPurchaseUnitCostMinor: 875 },
    ];
    expect(validatePurchaseOrderLines(lines, [{id:'first',purchaseUnits:[{label:'case',baseMicrosPerPurchaseUnit:24_000_000}]},{id:'second',purchaseUnits:[{label:'kg',baseMicrosPerPurchaseUnit:1_000_000}]}])).toBeNull();
    expect(calculatePurchaseOrderSubtotalMinor(lines)).toBe(5311);
  });

  it('rejects an unsupported purchase unit, non-positive quantity, and duplicate item/unit', () => {
    const items = [{id:'first',purchaseUnits:[{label:'piece',baseMicrosPerPurchaseUnit:1_000_000}]}];
    const line = { inventoryItemId: 'first', purchaseUnitLabel: 'piece', orderedPurchaseUnitsMicros: 1_000_000, expectedPurchaseUnitCostMinor: 200 };
    expect(validatePurchaseOrderLines([line,{...line}], items)).toMatch(/duplicate/i);
    expect(validatePurchaseOrderLines([{...line,purchaseUnitLabel:'case'}], items)).toMatch(/purchase unit/i);
    expect(validatePurchaseOrderLines([{...line,orderedPurchaseUnitsMicros:0}], items)).toMatch(/quantity/i);
  });
});
