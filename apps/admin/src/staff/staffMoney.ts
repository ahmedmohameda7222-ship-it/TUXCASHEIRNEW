/**
 * Financial inputs stay decimal strings until they have been converted to
 * integer minor units. Binary floating-point arithmetic must never round
 * payroll or compensation by a cent.
 */
export function parseStaffMoneyMinor(raw: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

export function formatStaffMoney(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
