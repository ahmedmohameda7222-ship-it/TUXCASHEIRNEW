export type OrderTimeRange = {
  from: string | null;
  to: string | null;
  error: string | null;
};

const cairoWallClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function cairoParts(epochMillis: number): ClockParts {
  const values = Object.fromEntries(
    cairoWallClock
      .formatToParts(new Date(epochMillis))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function sameWallClock(left: ClockParts, right: ClockParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute
  );
}

/** Interpret datetime-local values as Cairo wall time, not the device timezone.
 * A DST gap is invalid; an ambiguous repeated minute resolves to the earliest instant.
 */
export function cairoOrderInstant(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const expected = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  };
  const wallEpoch = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  const civil = new Date(wallEpoch);
  const civilParts = {
    year: civil.getUTCFullYear(),
    month: civil.getUTCMonth() + 1,
    day: civil.getUTCDate(),
    hour: civil.getUTCHours(),
    minute: civil.getUTCMinutes(),
  };
  if (!Number.isFinite(wallEpoch) || !sameWallClock(expected, civilParts)) return null;

  // Derive both sides of a DST transition from the IANA zone database.
  const offsets = new Set<number>();
  for (const hours of [-24, -6, 0, 6, 24]) {
    const sample = wallEpoch + hours * 3_600_000;
    const zoned = cairoParts(sample);
    const representedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
    );
    offsets.add((representedAsUtc - sample) / 60_000);
  }

  const validInstants: number[] = [];
  for (const offsetMinutes of offsets) {
    const instant = wallEpoch - offsetMinutes * 60_000;
    if (sameWallClock(cairoParts(instant), expected)) validInstants.push(instant);
  }
  if (validInstants.length === 0) return null;
  return new Date(Math.min(...validInstants)).toISOString();
}

export function toOrderTimeRange(fromInput: string, toInput: string): OrderTimeRange {
  const from = fromInput ? cairoOrderInstant(fromInput) : null;
  const to = toInput ? cairoOrderInstant(toInput) : null;
  if ((fromInput && !from) || (toInput && !to)) {
    return { from: null, to: null, error: 'Enter a valid date and time in Africa/Cairo.' };
  }
  if (from && to && from > to) {
    return { from: null, to: null, error: 'Start date/time must be before end date/time.' };
  }
  return { from, to, error: null };
}
