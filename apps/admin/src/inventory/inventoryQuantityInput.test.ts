import { describe, expect, it } from 'vitest';

import { parseInventoryMicros } from './inventoryQuantityInput';

describe('authoritative Inventory signed quantity entry', () => {
  it('rejects fractional micros instead of silently posting a rounded movement', () => {
    for (const value of ['0.0000005', '0.0000001', '-0.0000005', '1.0000001', '1e-6']) {
      expect(parseInventoryMicros(value, true)).toBeNull();
      expect(parseInventoryMicros(value, false)).toBeNull();
    }
  });

  it('preserves signed and positive exact micro units without IEEE rounding', () => {
    expect(parseInventoryMicros('0.000001', true)).toBe(1);
    expect(parseInventoryMicros('-0.000001', true)).toBe(-1);
    expect(parseInventoryMicros('+12.5', true)).toBe(12_500_000);
    expect(parseInventoryMicros(' 3.000001 ', false)).toBe(3_000_001);
    expect(parseInventoryMicros('9007199254.740991', true)).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseInventoryMicros('-9007199254.740991', true)).toBe(-Number.MAX_SAFE_INTEGER);
  });

  it('rejects zero, negative waste, unsafe and nonnumeric amounts', () => {
    for (const value of ['0', '-0', '0.000000', '', 'Infinity', 'NaN', '00.5']) {
      expect(parseInventoryMicros(value, true)).toBeNull();
    }
    expect(parseInventoryMicros('-1', false)).toBeNull();
    expect(parseInventoryMicros('-0.000001', false)).toBeNull();
    expect(parseInventoryMicros('9007199254.740992', false)).toBeNull();
  });
});
