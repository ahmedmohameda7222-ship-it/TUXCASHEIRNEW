import { describe, expect, it } from 'vitest';

import { parseReceiptLines, parseReturnLines } from './receivePurchaseValidation';

const line = {
  id: 'line-1',
  itemName: 'Meat',
  orderedPurchaseUnitsMicros: 5_000_000,
  receivedPurchaseUnitsMicros: 2_000_000,
  returnedPurchaseUnitsMicros: 500_000,
};

describe('trusted purchasing receipt form validation', () => {
  it('rejects empty costs rather than submitting a zero-cost receipt', () => {
    expect(parseReceiptLines([line], { 'line-1': '1' }, {})).toEqual({
      ok: false,
      error: 'Meat: enter a valid positive purchase-unit cost (EGP).',
    });
  });

  it('rejects malformed quantities, zero cost and excess receipts', () => {
    expect(parseReceiptLines([line], { 'line-1': 'bad' }, { 'line-1': '10' }).ok).toBe(false);
    expect(parseReceiptLines([line], { 'line-1': '1' }, { 'line-1': '0' }).ok).toBe(false);
    expect(parseReceiptLines([line], { 'line-1': '4' }, { 'line-1': '10' }).ok).toBe(false);
  });

  it('uses exact purchase-unit micros and minor units for valid partial receipts', () => {
    expect(parseReceiptLines([line], { 'line-1': '1.000001' }, { 'line-1': '25.99' })).toEqual({
      ok: true,
      lines: [
        { lineId: 'line-1', receivedPurchaseUnitsMicros: 1_000_001, purchaseUnitCostMinor: 2599 },
      ],
    });
  });

  it('rejects an invalid line instead of silently submitting another valid line', () => {
    const another = { ...line, id: 'line-2', itemName: 'Bread' };
    expect(
      parseReceiptLines(
        [line, another],
        { 'line-1': '1', 'line-2': 'no' },
        { 'line-1': '10', 'line-2': '20' },
      ).ok,
    ).toBe(false);
  });

  it('prevents returns exceeding the unreturned amount and validates precision', () => {
    expect(parseReturnLines([line], { 'line-1': '1.500001' }).ok).toBe(false);
    expect(parseReturnLines([line], { 'line-1': '1.0000001' }).ok).toBe(false);
    expect(parseReturnLines([line], { 'line-1': '1.5' })).toEqual({
      ok: true,
      lines: [{ lineId: 'line-1', returnedPurchaseUnitsMicros: 1_500_000 }],
    });
  });
});
