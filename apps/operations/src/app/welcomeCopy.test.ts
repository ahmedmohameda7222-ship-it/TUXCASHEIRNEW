import { describe, expect, it } from 'vitest';
import {
  MOTIVATIONAL_LINES,
  WELCOME_BUTTON_LABELS,
  chooseWelcomeCopy,
  greetingForLocalHour,
} from './welcomeCopy';

describe('greetingForLocalHour', () => {
  it.each([
    [0, 'Good morning, Sam.'],
    [11, 'Good morning, Sam.'],
    [12, 'Good afternoon, Sam.'],
    [17, 'Good afternoon, Sam.'],
    [18, 'Good evening, Sam.'],
    [23, 'Good evening, Sam.'],
  ])('uses the correct local greeting at hour %s', (hour, expected) => {
    expect(greetingForLocalHour(hour, 'Sam')).toBe(expected);
  });

  it.each([-1, 24, 1.5])('rejects invalid local hour %s', (hour) => {
    expect(() => greetingForLocalHour(hour, 'Sam')).toThrow(RangeError);
  });
});

describe('chooseWelcomeCopy', () => {
  it('uses the approved pools', () => {
    const copy = chooseWelcomeCopy({ previousLine: null, previousButton: null, random: () => 0 });

    expect(MOTIVATIONAL_LINES).toContain(copy.line);
    expect(WELCOME_BUTTON_LABELS).toContain(copy.button);
  });

  it('avoids immediately repeating the previous line and button when possible', () => {
    const copy = chooseWelcomeCopy({
      previousLine: MOTIVATIONAL_LINES[0],
      previousButton: WELCOME_BUTTON_LABELS[0],
      random: () => 0,
    });

    expect(copy.line).toBe(MOTIVATIONAL_LINES[1]);
    expect(copy.button).toBe(WELCOME_BUTTON_LABELS[1]);
  });
});
