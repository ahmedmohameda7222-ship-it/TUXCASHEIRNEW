import { describe, expect, it } from 'vitest';

import { formatEgp, parseEgpMinor } from './money';

describe('Finance EGP presentation', () => {
  it('renders only friendly EGP decimals', () => {
    expect(formatEgp(125000)).toBe('EGP 1,250.00');
    expect(formatEgp(-2500)).toBe('EGP -25.00');
    expect(formatEgp(0)).toBe('EGP 0.00');
  });

  it('converts decimal EGP to exact integer minor units without floating-point drift', () => {
    expect(parseEgpMinor('100')).toBe(10000);
    expect(parseEgpMinor('100.5')).toBe(10050);
    expect(parseEgpMinor('200.00')).toBe(20000);
    expect(parseEgpMinor('-25.25')).toBe(-2525);
  });

  it('rejects fractional minor units, exponents, and unsafe values', () => {
    for (const raw of ['0.001', '1e10', 'NaN', 'Infinity', '12,000', '99999999999999999', '']) {
      expect(() => parseEgpMinor(raw)).toThrow();
    }
  });
});
