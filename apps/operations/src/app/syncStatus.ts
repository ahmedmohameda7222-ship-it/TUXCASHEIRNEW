import { buildSyncHealth, type OutboxSyncSummary, type SyncHealthSnapshot } from '@tux/sync';

export interface SyncStatusStore {
  readonly getSnapshot: () => SyncHealthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly markRemoteConfigured: () => void;
  readonly markSyncStarted: () => void;
  readonly markSyncFinished: (result: OutboxSyncSummary | Error) => void;
}

export function createSyncStatusStore(options?: {
  readonly visibilityDelayMs?: number;
}): SyncStatusStore {
  const visibilityDelayMs = options?.visibilityDelayMs ?? 400;
  if (!Number.isFinite(visibilityDelayMs) || visibilityDelayMs < 0) {
    throw new RangeError('Sync status visibility delay must be a non-negative number.');
  }

  let snapshot = buildSyncHealth({ remoteConfigured: false });
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

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRemoteConfigured: () => {
      scheduleVisibleState(buildSyncHealth({ remoteConfigured: true }));
    },
    markSyncStarted: () => {
      scheduleVisibleState(buildSyncHealth({ remoteConfigured: true, syncing: true }));
    },
    markSyncFinished: (result) => {
      cancelVisibilityTimer();
      publish(
        buildSyncHealth({
          remoteConfigured: true,
          hasRun: true,
          lastResult: result,
        }),
      );
    },
  };
}
