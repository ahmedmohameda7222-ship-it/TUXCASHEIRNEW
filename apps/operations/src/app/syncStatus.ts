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
