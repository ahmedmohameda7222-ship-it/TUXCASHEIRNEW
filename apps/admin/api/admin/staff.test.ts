import { describe, expect, it } from 'vitest';

import { staffPinSchema } from './staff';

describe('Workforce Staff API PIN validation', () => {
  it('accepts the canonical numeric PIN format', () => {
    expect(staffPinSchema.safeParse('482731').success).toBe(true);
    expect(staffPinSchema.safeParse('1234').success).toBe(true);
    expect(staffPinSchema.safeParse('123456789012').success).toBe(true);
  });

  it('rejects non-numeric and escaped lookalike values', () => {
    expect(staffPinSchema.safeParse('12ab').success).toBe(false);
    expect(staffPinSchema.safeParse(String.raw`\dddd`).success).toBe(false);
    expect(staffPinSchema.safeParse('123').success).toBe(false);
    expect(staffPinSchema.safeParse('1234567890123').success).toBe(false);
  });
});
