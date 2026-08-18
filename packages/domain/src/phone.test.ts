import { describe, expect, it } from 'vitest';
import { normalizeEgyptianPhone } from './phone';

describe('normalizeEgyptianPhone', () => {
  it.each([
    ['01012345678', '01012345678', '+201012345678'],
    ['+20 10 1234 5678', '01012345678', '+201012345678'],
    ['00201012345678', '01012345678', '+201012345678'],
    ['201012345678', '01012345678', '+201012345678'],
    ['1012345678', '01012345678', '+201012345678'],
  ])('normalizes %s to the canonical local form', (raw, normalizedPhone, displayPhone) => {
    expect(normalizeEgyptianPhone(raw)).toEqual({ normalizedPhone, displayPhone, valid: true });
  });

  it('does not treat truncated legacy-compatible output as valid', () => {
    expect(normalizeEgyptianPhone('010123')).toEqual({
      normalizedPhone: '010123',
      displayPhone: '010123',
      valid: false,
    });
  });

  it('caps excess digits using the legacy normalization boundary but validates the canonical result', () => {
    expect(normalizeEgyptianPhone('01012345678999')).toEqual({
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      valid: true,
    });
  });
});
