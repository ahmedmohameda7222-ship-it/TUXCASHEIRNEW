import type { SyncHealthState } from '@tux/sync';
import { useSyncExternalStore } from 'react';
import { syncStatusStore } from './syncStatus';

const STATUS_TEXT: Record<SyncHealthState, string> = {
  LOCAL_ONLY: 'Local only',
  SYNC_PENDING: 'Syncing…',
  SYNCING: 'Syncing…',
  SYNCED: 'Synced',
  SYNC_RETRYING: 'Offline',
  SYNC_ISSUE: 'Sync issue',
};

function SyncStatusIcon({ state }: { readonly state: SyncHealthState }) {
  if (state === 'SYNCED') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5 9.3 17 19 7" />
      </svg>
    );
  }
  if (state === 'SYNC_ISSUE') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 21 20H3L12 3Z" />
        <path d="M12 9v5M12 17.5v.5" />
      </svg>
    );
  }
  if (state === 'SYNC_RETRYING') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 4 20 20" />
        <path d="M6.5 9.5A8 8 0 0 1 18 8M8 17a8 8 0 0 0 9.5-2.5" />
      </svg>
    );
  }
  if (state === 'LOCAL_ONLY') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14v10H5zM8 17v2h8v-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 8a8 8 0 0 0-13-2L4 8M5 16a8 8 0 0 0 13 2l2-2" />
      <path d="M4 4v4h4M20 20v-4h-4" />
    </svg>
  );
}

export function SyncStatusIndicator() {
  const snapshot = useSyncExternalStore(
    syncStatusStore.subscribe,
    syncStatusStore.getSnapshot,
    syncStatusStore.getSnapshot,
  );
  const text = STATUS_TEXT[snapshot.state];

  return (
    <span
      className="sync-status"
      data-state={snapshot.state}
      role="status"
      aria-live="polite"
      aria-label={`Sync status: ${text}`}
      title={text}
    >
      <SyncStatusIcon state={snapshot.state} />
      <span>{text}</span>
    </span>
  );
}
