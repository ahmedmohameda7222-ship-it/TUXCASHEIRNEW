import type { ShopId } from '@tux/domain';
import type { CachedOnlineOrderRequest, OnlineOrderInboxStore } from '@tux/persistence';
import {
  syncOnlineOrderInboxSnapshot,
  type OnlineOrderOperationsRemote,
} from './onlineOrderInboxSync';

export type OnlineOrderInboxSyncState = 'CACHED' | 'SYNCED' | 'REMOTE_UNAVAILABLE';

export interface OnlineOrderInboxSnapshot {
  readonly requests: readonly CachedOnlineOrderRequest[];
  readonly syncState: OnlineOrderInboxSyncState;
  readonly errorMessage: string | null;
}

export interface OnlineOrderInboxRuntimeClient {
  load(): Promise<OnlineOrderInboxSnapshot>;
  subscribe(listener: (snapshot: OnlineOrderInboxSnapshot) => void): () => void;
}

const REMOTE_UNAVAILABLE_MESSAGE = 'Online orders could not refresh. Showing the saved inbox.';

export async function loadOnlineOrderInbox(input: {
  readonly shopId: ShopId;
  readonly store: OnlineOrderInboxStore;
  readonly remote: OnlineOrderOperationsRemote;
  readonly publish: (snapshot: OnlineOrderInboxSnapshot) => void;
}): Promise<OnlineOrderInboxSnapshot> {
  const cached = await input.store.list(input.shopId);
  input.publish({
    requests: cached,
    syncState: 'CACHED',
    errorMessage: null,
  });

  try {
    const synced = await syncOnlineOrderInboxSnapshot({
      shopId: input.shopId,
      store: input.store,
      remote: input.remote,
    });
    const snapshot: OnlineOrderInboxSnapshot = {
      requests: synced,
      syncState: 'SYNCED',
      errorMessage: null,
    };
    input.publish(snapshot);
    return snapshot;
  } catch {
    const saved = await input.store.list(input.shopId);
    const snapshot: OnlineOrderInboxSnapshot = {
      requests: saved,
      syncState: 'REMOTE_UNAVAILABLE',
      errorMessage: REMOTE_UNAVAILABLE_MESSAGE,
    };
    input.publish(snapshot);
    return snapshot;
  }
}

export function createOnlineOrderInboxRuntime(input: {
  readonly getActiveShopId: () => Promise<ShopId>;
  readonly store: OnlineOrderInboxStore;
  readonly remote: OnlineOrderOperationsRemote;
}): OnlineOrderInboxRuntimeClient {
  const listeners = new Set<(snapshot: OnlineOrderInboxSnapshot) => void>();
  const publish = (snapshot: OnlineOrderInboxSnapshot): void => {
    for (const listener of listeners) listener(snapshot);
  };

  return {
    load: async () =>
      loadOnlineOrderInbox({
        shopId: await input.getActiveShopId(),
        store: input.store,
        remote: input.remote,
        publish,
      }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
