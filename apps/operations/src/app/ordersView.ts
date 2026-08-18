import type { MoneyMinor, OrderDraft } from '@tux/domain';

const BROWSER_DRAFT_SCOPE_KEY = 'tux.orders.draft-scope-id';

export function formatMoneyMinor(value: MoneyMinor): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const pounds = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}EGP ${pounds.toString()}.${cents}`;
}

export function moneyMinorInputValue(value: MoneyMinor): string {
  const minor = BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const pounds = absolute / 100n;
  const cents = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${pounds.toString()}.${cents}`;
}

export function nextDraftAddedSequence(draft: OrderDraft): number {
  const latest = draft.lines.reduce((maximum, line) => Math.max(maximum, line.addedSequence), 0);
  const next = latest + 1;
  if (!Number.isSafeInteger(next)) {
    throw new RangeError('Draft addition sequence exceeded the safe integer range.');
  }
  return next;
}

export function resolveOrdersDraftScopeId(): string {
  if (window.tuxDesktop !== undefined) return 'desktop-main-window';

  try {
    const existing = window.sessionStorage.getItem(BROWSER_DRAFT_SCOPE_KEY);
    if (existing !== null && existing.trim().length > 0) return existing;
    const created = `browser-tab:${crypto.randomUUID()}`;
    window.sessionStorage.setItem(BROWSER_DRAFT_SCOPE_KEY, created);
    return created;
  } catch {
    return `browser-tab:${crypto.randomUUID()}`;
  }
}
