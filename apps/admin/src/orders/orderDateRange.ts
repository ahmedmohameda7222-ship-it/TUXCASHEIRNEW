export type OrderTimeRange = {
  from: string | null;
  to: string | null;
  error: string | null;
};

/** Form input is a browser-local datetime; the API expects ISO instants. */
export function toOrderTimeRange(fromInput: string, toInput: string): OrderTimeRange {
  const parse = (value: string): string | null => {
    if (!value) return null;
    const timestamp = new Date(value);
    return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  };
  const from = parse(fromInput);
  const to = parse(toInput);
  if ((fromInput && !from) || (toInput && !to)) {
    return { from: null, to: null, error: 'Enter a valid date and time.' };
  }
  if (from && to && from > to) {
    return { from: null, to: null, error: 'Start date/time must be before end date/time.' };
  }
  return { from, to, error: null };
}
