import type { BusinessDay, OpenBusinessDay, ShopId } from '@tux/domain';

export interface CanonicalBusinessDayState {
  readonly day: OpenBusinessDay | null;
  readonly openWorkerCount: number;
}

/**
 * Sign-in reconnects to the server's original OPEN-day identity, never creates
 * a duplicate. A local offline day remains valid when the server has no OPEN day.
 * Conflicting development fixtures are archived by an explicit persistence callback
 * that retains their outbox history as quarantined events for inspection.
 */
export async function reconcileCanonicalBusinessDay(input: {
  readonly shopId: ShopId;
  readonly drainLocalOutbox: () => Promise<void>;
  readonly getLocalOpenDay: () => Promise<OpenBusinessDay | null>;
  readonly getCanonicalState: (shopId: ShopId) => Promise<CanonicalBusinessDayState>;
  readonly adoptCanonicalDay: (
    canonical: OpenBusinessDay,
    previouslyLocal: OpenBusinessDay | null,
  ) => Promise<void>;
}): Promise<number> {
  await input.drainLocalOutbox();
  const canonical = await input.getCanonicalState(input.shopId);
  if (!Number.isSafeInteger(canonical.openWorkerCount) || canonical.openWorkerCount < 0) {
    throw new Error('Canonical open-worker count is invalid.');
  }
  if (canonical.day !== null && canonical.day.shopId !== input.shopId) {
    throw new Error('Canonical Business Day response belongs to a different shop.');
  }
  const local = await input.getLocalOpenDay();
  if (
    canonical.day !== null &&
    (canonical.day.id !== local?.id ||
      canonical.day.lastAllocatedDisplayOrderNo > (local?.lastAllocatedDisplayOrderNo ?? -1))
  ) {
    await input.adoptCanonicalDay(canonical.day, local);
  }
  return canonical.openWorkerCount;
}

/** Only a non-final worker may sign out without closing the Business Day. */
export function requiresEndDayOnWorkerExit(openWorkerCount: number): boolean {
  if (!Number.isSafeInteger(openWorkerCount) || openWorkerCount < 0) {
    throw new Error('Canonical open-worker count is invalid.');
  }
  return openWorkerCount <= 1;
}

/** Never overwrite a locally completed, possibly still queued, End Day. */
export function assertCanonicalDayNotLocallyClosed(previouslyStored: BusinessDay | null): void {
  if (previouslyStored?.status === 'CLOSED') {
    throw new Error('Business Day ended locally. Synchronize End Day before rejoining.');
  }
}
