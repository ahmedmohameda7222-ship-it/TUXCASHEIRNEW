export const MOTIVATIONAL_LINES = [
  'Let’s make today a great one.',
  'You’ve got this.',
  'Make today count.',
  'Let’s make it a great one.',
  'Own the day.',
  'Ready to make it happen?',
  'Bring your best.',
  'Let’s make today a win.',
  'Here’s to a great day ahead.',
  'Make today a good one.',
  'Here’s to a smooth one.',
  'Good things ahead.',
  'Ready when you are.',
] as const;

export const WELCOME_BUTTON_LABELS = [
  'I’m Ready',
  'Let’s Do This',
  'Get Going',
  'Start Strong',
  'Make It Happen',
  'On We Go',
  'Here We Go',
  'I’m In',
  'Let’s Begin',
  'Go',
  'Let’s Roll',
] as const;

export interface WelcomeCopy {
  readonly line: (typeof MOTIVATIONAL_LINES)[number];
  readonly button: (typeof WELCOME_BUTTON_LABELS)[number];
}

export function greetingForLocalHour(hour: number, displayName: string): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('Greeting hour must be an integer from 0 through 23.');
  }
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${salutation}, ${displayName}.`;
}

function chooseFromPool<const Value extends string>(
  pool: readonly Value[],
  previous: string | null,
  random: () => number,
): Value {
  const candidates = pool.length > 1 ? pool.filter((value) => value !== previous) : pool;
  const index = Math.min(
    candidates.length - 1,
    Math.floor(Math.max(0, random()) * candidates.length),
  );
  const selected = candidates[index];
  if (selected === undefined) throw new RangeError('Welcome copy pool must not be empty.');
  return selected;
}

export function chooseWelcomeCopy({
  previousLine,
  previousButton,
  random = Math.random,
}: {
  readonly previousLine: string | null;
  readonly previousButton: string | null;
  readonly random?: () => number;
}): WelcomeCopy {
  return {
    line: chooseFromPool(MOTIVATIONAL_LINES, previousLine, random),
    button: chooseFromPool(WELCOME_BUTTON_LABELS, previousButton, random),
  };
}
