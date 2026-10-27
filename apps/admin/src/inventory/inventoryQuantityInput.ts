/** Parse base-unit stock deltas without floating-point rounding.
 * Inventory quantities are exact signed integer micros in the trusted ledger.
 * Inputs smaller than one micro, exponent notation and unsafe values are invalid.
 */
export function parseInventoryMicros(value: string, allowNegative: boolean): number | null {
  const match = /^([+-]?)(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match || (match[1] === '-' && !allowNegative)) return null;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt((match[3] ?? '').padEnd(6, '0'));
  const magnitude = whole * 1_000_000n + fraction;
  if (magnitude === 0n || magnitude > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(magnitude) * (match[1] === '-' ? -1 : 1);
}
