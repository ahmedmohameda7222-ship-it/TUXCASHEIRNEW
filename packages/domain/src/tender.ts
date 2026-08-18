import { DomainInvariantError } from './errors';
import { moneyMinor, type MoneyMinor } from './money';

export interface TenderSuggestion {
  readonly totalMinor: MoneyMinor;
  readonly notesMinor: readonly MoneyMinor[];
}

export function suggestCashTenders(
  totalMinor: MoneyMinor,
  denominationsMinor: readonly MoneyMinor[] = [
    moneyMinor(5_000),
    moneyMinor(10_000),
    moneyMinor(20_000),
  ],
): readonly TenderSuggestion[] {
  if (totalMinor <= 0) return [];
  const denominations = [...new Set(denominationsMinor)]
    .filter((value) => value > 0)
    .sort((left, right) => right - left);
  if (denominations.length === 0) {
    throw new DomainInvariantError('At least one positive cash denomination is required.');
  }

  const minDenomination = denominations.at(-1);
  if (minDenomination === undefined) return [];
  const maxNotes = Math.ceil(totalMinor / minDenomination) + 1;
  const byTotal = new Map<number, TenderSuggestion>();

  function visit(index: number, notes: MoneyMinor[], sum: number): void {
    if (notes.length > maxNotes) return;
    if (index === denominations.length) {
      if (sum < totalMinor || notes.length === 0) return;
      const minimal = notes.every((note) => sum - note < totalMinor);
      if (!minimal) return;
      if (!byTotal.has(sum)) {
        byTotal.set(sum, {
          totalMinor: moneyMinor(sum),
          notesMinor: [...notes].sort((left, right) => right - left),
        });
      }
      return;
    }

    const denomination = denominations[index];
    if (denomination === undefined) return;
    for (let count = 0; count <= maxNotes - notes.length; count += 1) {
      const added = denomination * count;
      if (!Number.isSafeInteger(sum + added)) {
        throw new DomainInvariantError('Tender suggestion exceeded safe integer range.');
      }
      const nextNotes =
        count === 0 ? notes : [...notes, ...Array<MoneyMinor>(count).fill(denomination)];
      visit(index + 1, nextNotes, sum + added);
    }
  }

  visit(0, [], 0);
  return [...byTotal.values()].sort((left, right) => left.totalMinor - right.totalMinor);
}
