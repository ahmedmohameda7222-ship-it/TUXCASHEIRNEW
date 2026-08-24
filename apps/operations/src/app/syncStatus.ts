import { buildSyncHealth, type OutboxSyncSummary, type SyncHealthSnapshot } from '@tux/sync';

export interface SyncStatusStore {
  readonly getSnapshot: () => SyncHealthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly markRemoteConfigured: () => void;
  readonly markSyncStarted: () => void;
  readonly markSyncFinished: (result: OutboxSyncSummary | Error) => void;
}

export function createSyncStatusStore(_options?: {
  readonly visibilityDelayMs?: number;
}): SyncStatusStore {
  let snapshot = buildSyncHealth({ remoteConfigured: false });
  const listeners = new Set<() => void>();

  const publish = (next: SyncHealthSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markRemoteConfigured: () => undefined,
    markSyncStarted: () => undefined,
    markSyncFinished: (result) => {
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
