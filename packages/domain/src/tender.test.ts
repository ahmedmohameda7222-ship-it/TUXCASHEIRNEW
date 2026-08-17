import { describe, expect, it } from 'vitest';
import { moneyMinor } from './money';
import { suggestCashTenders } from './tender';

function pounds(value: number) {
  return moneyMinor(value * 100);
}

function suggestionPounds(total: number): number[] {
  return suggestCashTenders(pounds(total)).map((suggestion) => suggestion.totalMinor / 100);
}

describe('suggestCashTenders', () => {
  it.each([
    [180, [200]],
    [230, [250, 300, 400]],
    [370, [400]],
    [410, [450, 500, 600]],
    [620, [650, 700, 800]],
    [760, [800]],
  ])('matches the approved minimal bundles for E£%s', (total, expected) => {
    expect(suggestionPounds(total)).toEqual(expected);
  });

  it('ensures removing any one note makes every suggestion insufficient', () => {
    const total = pounds(620);
    for (const suggestion of suggestCashTenders(total)) {
      for (const note of suggestion.notesMinor) {
        expect(suggestion.totalMinor - note).toBeLessThan(total);
      }
    }
  });
});
