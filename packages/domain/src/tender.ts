import { DomainInvariantError } from './errors';
import { moneyMinor, type MoneyMinor } from './money';

export interface TenderSuggestion {
  readonly totalMinor: MoneyMinor;
  readonly notesMinor: readonly MoneyMinor[];
}

const DEFAULT_ROUNDING_STEPS_MINOR = [
  moneyMinor(1_000),
  moneyMinor(2_000),
  moneyMinor(5_000),
  moneyMinor(10_000),
  moneyMinor(20_000),
] as const;

function roundUpToStep(value: MoneyMinor, step: MoneyMinor): MoneyMinor {
  const remainder = value % step;
  if (remainder === 0) return value;
  const rounded = value + step - remainder;
  if (!Number.isSafeInteger(rounded)) {
    throw new DomainInvariantError('Tender suggestion exceeded safe integer range.');
  }
  return moneyMinor(rounded);
}

export function suggestCashTenders(
  totalMinor: MoneyMinor,
  roundingStepsMinor: readonly MoneyMinor[] = DEFAULT_ROUNDING_STEPS_MINOR,
): readonly TenderSuggestion[] {
  if (totalMinor <= 0) return [];
  if (roundingStepsMinor.length === 0) {
    throw new DomainInvariantError('At least one positive cash rounding step is required.');
  }

  const uniqueSteps = [...new Set(roundingStepsMinor)];
  for (const step of uniqueSteps) {
    if (!Number.isSafeInteger(step) || step <= 0) {
      throw new DomainInvariantError('Cash rounding steps must be positive safe integers.');
    }
  }

  const totals = new Set<number>([totalMinor]);
  for (const step of uniqueSteps) {
    totals.add(roundUpToStep(totalMinor, step));
  }

  return [...totals]
    .sort((left, right) => left - right)
    .map((total) => ({ totalMinor: moneyMinor(total), notesMinor: [] }));
}
