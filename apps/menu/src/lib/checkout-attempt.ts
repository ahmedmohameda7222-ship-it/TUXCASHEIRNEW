export interface PendingCheckoutAttempt {
  readonly fingerprint: string;
  readonly idempotencyKey: string;
}

const STORAGE_KEY = 'tux:menu:pending-online-order-attempt:v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function browserStorage(): Storage {
  if (typeof window === 'undefined') throw new Error('checkout_attempt_storage_unavailable');
  return window.localStorage;
}

export function loadPendingCheckoutAttempt(): PendingCheckoutAttempt | null {
  try {
    const value = browserStorage().getItem(STORAGE_KEY);
    if (value === null) return null;
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      clearPendingCheckoutAttempt();
      return null;
    }
    const source = parsed as Record<string, unknown>;
    if (
      typeof source.fingerprint !== 'string' ||
      source.fingerprint.length === 0 ||
      typeof source.idempotencyKey !== 'string' ||
      !UUID_PATTERN.test(source.idempotencyKey)
    ) {
      clearPendingCheckoutAttempt();
      return null;
    }
    return { fingerprint: source.fingerprint, idempotencyKey: source.idempotencyKey };
  } catch {
    return null;
  }
}

export function persistPendingCheckoutAttempt(attempt: PendingCheckoutAttempt): void {
  browserStorage().setItem(STORAGE_KEY, JSON.stringify(attempt));
}

export function clearPendingCheckoutAttempt(): void {
  try {
    browserStorage().removeItem(STORAGE_KEY);
  } catch {
    /* best effort */
  }
}
