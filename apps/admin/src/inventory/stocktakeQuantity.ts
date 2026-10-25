/**
 * Physical counts are nonnegative base-unit micros. Reject sub-micro values
 * instead of silently rounding a counted quantity into a ledger movement.
 */
export function parseStocktakeMicros(raw: string): number | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 32 || !/^\d+(?:\.\d{1,6})?$/.test(value)) {
    return null;
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}
