import { describe, expect, it } from 'vitest';
import { greetingForHour } from './session';

describe('greetingForHour', () => {
  it('uses the approved time-aware salutation boundaries', () => {
    expect(greetingForHour(0, 'Ahmed')).toBe('Good morning, Ahmed.');
    expect(greetingForHour(11, 'Ahmed')).toBe('Good morning, Ahmed.');
    expect(greetingForHour(12, 'Ahmed')).toBe('Good afternoon, Ahmed.');
    expect(greetingForHour(17, 'Ahmed')).toBe('Good afternoon, Ahmed.');
    expect(greetingForHour(18, 'Ahmed')).toBe('Good evening, Ahmed.');
    expect(greetingForHour(23, 'Ahmed')).toBe('Good evening, Ahmed.');
  });

  it('rejects invalid hours rather than guessing', () => {
    expect(() => greetingForHour(-1, 'Ahmed')).toThrow(RangeError);
    expect(() => greetingForHour(24, 'Ahmed')).toThrow(RangeError);
    expect(() => greetingForHour(12.5, 'Ahmed')).toThrow(RangeError);
  });
});
