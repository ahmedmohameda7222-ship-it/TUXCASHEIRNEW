import { describe, expect, it } from 'vitest';

import { formatStaffMoney, parseStaffMoneyMinor } from './staffMoney';

describe('Staff exact minor-unit financial input', () => {
  it('round-trips the largest even safe minor value without adding a cent', () => {
    const value = Number.MAX_SAFE_INTEGER - 1;
    expect(formatStaffMoney(value)).toBe('90071992547409.90');
    expect(parseStaffMoneyMinor('90071992547409.90')).toBe(value);
  });

  it('rejects precision loss, unsafe amounts and negative payroll entries', () => {
    expect(parseStaffMoneyMinor('0.001')).toBeNull();
    expect(parseStaffMoneyMinor('90071992547409.92')).toBeNull();
    expect(parseStaffMoneyMinor('-1.00')).toBeNull();
    expect(parseStaffMoneyMinor('NaN')).toBeNull();
    expect(parseStaffMoneyMinor('')).toBeNull();
    expect(formatStaffMoney(Number.MAX_SAFE_INTEGER + 1)).toBe('Unavailable');
  });

  it('retains both whole amounts and two decimal places', () => {
    expect(parseStaffMoneyMinor('123')).toBe(12300);
    expect(parseStaffMoneyMinor('123.4')).toBe(12340);
    expect(parseStaffMoneyMinor('123.45')).toBe(12345);
    expect(formatStaffMoney(12345)).toBe('123.45');
  });
});
