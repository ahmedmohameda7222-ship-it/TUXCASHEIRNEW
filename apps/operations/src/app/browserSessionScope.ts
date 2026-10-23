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
    // The online Operations browser requires an authoritative remote device session.
  }
  if (remote === local.value.shopId) return local;
  return closeLocalSession();
}
