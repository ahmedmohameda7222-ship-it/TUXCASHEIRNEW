import type { OperationsSessionResult } from '@tux/application';
import type { ShopId } from '@tux/domain';

/** A cached worker session cannot authorize a different or missing remote device shop. */
export async function fenceStaleBrowserSession(
  local: OperationsSessionResult,
  remoteShopId: () => Promise<ShopId | null>,
  closeLocalSession: () => Promise<OperationsSessionResult>,
): Promise<OperationsSessionResult> {
  if (!local.ok || local.value.status !== 'ACTIVE') return local;

  try {
    const remote = await remoteShopId();
    if (remote === local.value.shopId) return local;
  } catch {
    // Keep the last-known-good worker session during an offline outage.
    // Definitively missing or different remote shops still force a sign-out.
    return local;
  }
  return closeLocalSession();
}
