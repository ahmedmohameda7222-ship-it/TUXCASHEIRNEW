const cairoCalendar = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function cairoDayAt(timestamp: number): string {
  const parts = cairoCalendar.formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function firstUtcInstantForCairoDay(day: string): number {
  const midnightUtc = Date.parse(`${day}T00:00:00.000Z`);
  let lower = midnightUtc - 12 * 60 * 60_000;
  let upper = midnightUtc + 12 * 60 * 60_000;
  // Binary search in milliseconds preserves Egypt's DST transitions, including
  // the midnight-hour transition where a fixed +02/+03 offset would be wrong.
  while (lower < upper) {
    const candidate = Math.floor((lower + upper) / 2);
    if (cairoDayAt(candidate) < day) lower = candidate + 1;
    else upper = candidate;
  }
  return lower;
}

export function cairoCalendarDayRange(day: string): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const instant = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== day) {
    return null;
  }
  const tomorrow = new Date(instant + 86_400_000).toISOString().slice(0, 10);
  return {
    from: new Date(firstUtcInstantForCairoDay(day)).toISOString(),
    to: new Date(firstUtcInstantForCairoDay(tomorrow) - 1).toISOString(),
  };
}
