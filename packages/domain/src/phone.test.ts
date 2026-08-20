import { describe, expect, it } from 'vitest';
import { normalizeEgyptianPhone } from './phone';

describe('normalizeEgyptianPhone', () => {
  it.each([
    ['01012345678', '01012345678', '+201012345678'],
    ['+20 10 1234 5678', '01012345678', '+201012345678'],
    ['00201012345678', '01012345678', '+201012345678'],
    ['201012345678', '01012345678', '+201012345678'],
    ['1012345678', '01012345678', '+201012345678'],
    ['(011) 2345-6789', '01123456789', '+201123456789'],
    ['012 3456 7890', '01234567890', '+201234567890'],
    ['015/1234/5678', '01512345678', '+201512345678'],
  ])('normalizes %s to the canonical local form', (raw, normalizedPhone, displayPhone) => {
    expect(normalizeEgyptianPhone(raw)).toEqual({ normalizedPhone, displayPhone, valid: true });
  });

  it.each([
    '010123',
    '01012345678999',
    '+20101234567899',
    '0020101234567899',
    '20101234567899',
    '01312345678',
    '01612345678',
    '02012345678',
    '+491701234567',
    '01012345678 ext 2',
  ])('rejects malformed or unsupported input %s without truncation', (raw) => {
    expect(normalizeEgyptianPhone(raw).valid).toBe(false);
  });

  it('does not silently turn an overlong number into a different valid customer identity', () => {
    const result = normalizeEgyptianPhone('01012345678999');
    expect(result.valid).toBe(false);
    expect(result.normalizedPhone).not.toBe('01012345678');
  });
});
