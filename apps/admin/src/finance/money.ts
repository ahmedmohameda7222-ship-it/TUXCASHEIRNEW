const moneyFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEgp(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new Error('invalid_money_amount');
  return `EGP ${moneyFormatter.format(minor / 100)}`;
}

export function parseEgpMinor(value: string): number {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error('Enter a valid EGP amount, using at most two decimal places.');
  const whole = BigInt(match[2]!);
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  const cents = (whole * 100n + fraction) * (match[1] === '-' ? -1n : 1n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error('Amount is too large.');
  }
  return Number(cents);
}
