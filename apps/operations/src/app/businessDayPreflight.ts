import type { BusinessDayId, ShopId } from '@tux/domain';

/**
 * Preserve immutable local day IDs and outbox events. Never auto-adopt another
 * browser's OPEN day, as its receipt sequence and worker session are device-local.
 */
export async function assertCanonicalBusinessDayReady(input: {
  readonly shopId: ShopId;
  readonly drainLocalOutbox: () => Promise<void>;
  readonly getLocalOpenDayId: () => Promise<BusinessDayId | null>;
  readonly getCanonicalOpenDayId: (shopId: ShopId) => Promise<BusinessDayId | null>;
}): Promise<void> {
  await input.drainLocalOutbox();
  const canonical = await input.getCanonicalOpenDayId(input.shopId);
  const local = await input.getLocalOpenDayId();
  if (canonical === null && local !== null) {
    throw new Error(
      'Local Business Day ' +
        local +
        ' remains OPEN, but Supabase has no matching OPEN day. Synchronize the original local Business Day start before signing in, or investigate a remotely closed day. Do not change day IDs or clear IndexedDB.',
    );
  }
  if (canonical !== null && canonical !== local) {
    throw new Error(
      'Canonical Business Day ' +
        canonical +
        ' is still OPEN in Supabase. Reconnect the original browser and synchronize End Day before starting another day. Do not clear IndexedDB or replace Business Day IDs.',
    );
  }
}
