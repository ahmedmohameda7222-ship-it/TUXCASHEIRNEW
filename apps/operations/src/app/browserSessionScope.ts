import type { OperationsSessionResult } from '@tux/application';
import type { ShopId } from '@tux/domain';

/** A cached worker session cannot authorize a different or missing remote device shop. */
export async function fenceStaleBrowserSession(
  local: OperationsSessionResult,
  remoteShopId: () => Promise<ShopId | null>,
  closeLocalSession: () => Promise<OperationsSessionResult>,
): Promise<OperationsSessionResult> {
  if (!local.ok || local.value.status !== 'ACTIVE') return local;

  let remote: ShopId | null = null;
  try {
    remote = await remoteShopId();
  } catch {
    // A transient connection failure is not a revocation. Keep the last-known-good
    // local session for offline operation; a definite absence or shop change still fences it.
    return local;
  }
  if (remote === local.value.shopId) return local;
  return closeLocalSession();
}
