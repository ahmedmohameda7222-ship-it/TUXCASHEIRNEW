import type { TuxDesktopApi, TuxSyncHealthSnapshot } from '@tux/platform-contracts';
import { buildSyncHealth, type OutboxSyncSummary, type SyncHealthSnapshot } from '@tux/sync';

export interface SyncStatusStore {
  readonly getSnapshot: () => SyncHealthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly markRemoteConfigured: () => void;
  readonly markSyncStarted: () => void;
  readonly markSyncFinished: (result: OutboxSyncSummary | Error) => void;
  readonly setOnline: (online: boolean) => void;
  readonly setExternalSnapshot: (snapshot: TuxSyncHealthSnapshot) => void;
}

export function createSyncStatusStore(options?: {
  readonly visibilityDelayMs?: number;
}): SyncStatusStore {
  const visibilityDelayMs = options?.visibilityDelayMs ?? 400;
  if (!Number.isFinite(visibilityDelayMs) || visibilityDelayMs < 0) {
    throw new RangeError('Sync status visibility delay must be a non-negative number.');
  }

  let snapshot = buildSyncHealth({ remoteConfigured: false });
  let remoteConfigured = false;
  let hasRun = false;
  let syncing = false;
  let offline = false;
  let lastResult: OutboxSyncSummary | Error | null = null;
  let visibilityTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: SyncHealthSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const cancelVisibilityTimer = (): void => {
    if (visibilityTimer !== null) clearTimeout(visibilityTimer);
    visibilityTimer = null;
  };

  const scheduleVisibleState = (next: SyncHealthSnapshot): void => {
    cancelVisibilityTimer();
    visibilityTimer = setTimeout(() => {
      visibilityTimer = null;
      publish(next);
    }, visibilityDelayMs);
  };

  const currentHealth = (): SyncHealthSnapshot => {
    if (!remoteConfigured) return buildSyncHealth({ remoteConfigured: false });
    if (offline) {
      return {
        state: 'SYNC_RETRYING',
        label: 'Sync retrying',
        remoteConfigured: true,
        attentionRequired: false,
      };
    }
    return buildSyncHealth({
      remoteConfigured: true,
      syncing,
      hasRun,
      lastResult,
    });
  };

  const publishTransientAware = (next: SyncHealthSnapshot): void => {
    if (next.state === 'SYNC_PENDING' || next.state === 'SYNCING') {
      scheduleVisibleState(next);
      return;
    }
    cancelVisibilityTimer();
    publish(next);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRemoteConfigured: () => {
      remoteConfigured = true;
      publishTransientAware(currentHealth());
    },
    markSyncStarted: () => {
      remoteConfigured = true;
      syncing = true;
      publishTransientAware(currentHealth());
    },
    markSyncFinished: (result) => {
      remoteConfigured = true;
      syncing = false;
      hasRun = true;
      lastResult = result;
      publishTransientAware(currentHealth());
    },
    setOnline: (online) => {
      if (!remoteConfigured) return;
      offline = !online;
      publishTransientAware(currentHealth());
    },
    setExternalSnapshot: (next) => {
      remoteConfigured = next.remoteConfigured;
      publishTransientAware(next);
    },
  };
}

export const syncStatusStore = createSyncStatusStore();
export const browserSyncStatusStore = syncStatusStore;

export function connectDesktopSyncStatus(api: TuxDesktopApi['sync']): () => void {
  let active = true;
  let eventVersion = 0;
  const unsubscribe = api.subscribe((next) => {
    if (!active) return;
    eventVersion += 1;
    syncStatusStore.setExternalSnapshot(next);
  });
  const versionAtRequest = eventVersion;

  void api
    .getStatus()
    .then((next) => {
      if (active && eventVersion === versionAtRequest) syncStatusStore.setExternalSnapshot(next);
    })
    .catch((cause: unknown) => {
      if (!active || eventVersion !== versionAtRequest) return;
      syncStatusStore.markSyncFinished(
        cause instanceof Error ? cause : new Error('Could not read desktop sync status.'),
      );
    });

  return () => {
    active = false;
    unsubscribe();
  };
}
