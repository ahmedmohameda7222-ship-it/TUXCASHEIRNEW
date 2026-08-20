import type { OutboxSyncSummary } from './outboxSync';

export type SyncHealthState =
  'LOCAL_ONLY' | 'SYNC_PENDING' | 'SYNCING' | 'SYNCED' | 'SYNC_RETRYING' | 'SYNC_ISSUE';

export interface SyncHealthSnapshot {
  readonly state: SyncHealthState;
  readonly label:
    'Local only' | 'Sync pending' | 'Syncing' | 'Synced' | 'Sync retrying' | 'Sync issue';
  readonly remoteConfigured: boolean;
  readonly attentionRequired: boolean;
}

export function buildSyncHealth(input: {
  readonly remoteConfigured: boolean;
  readonly syncing?: boolean;
  readonly hasRun?: boolean;
  readonly lastResult?: OutboxSyncSummary | Error | null;
}): SyncHealthSnapshot {
  if (!input.remoteConfigured) {
    return {
      state: 'LOCAL_ONLY',
      label: 'Local only',
      remoteConfigured: false,
      attentionRequired: false,
    };
  }
  if (input.syncing) {
    return {
      state: 'SYNCING',
      label: 'Syncing',
      remoteConfigured: true,
      attentionRequired: false,
    };
  }
  const result = input.lastResult ?? null;
  if (result instanceof Error) {
    return {
      state: 'SYNC_ISSUE',
      label: 'Sync issue',
      remoteConfigured: true,
      attentionRequired: true,
    };
  }
  if (result?.quarantined) {
    return {
      state: 'SYNC_ISSUE',
      label: 'Sync issue',
      remoteConfigured: true,
      attentionRequired: true,
    };
  }
  if (result?.failed) {
    return {
      state: 'SYNC_RETRYING',
      label: 'Sync retrying',
      remoteConfigured: true,
      attentionRequired: false,
    };
  }
  if (!input.hasRun) {
    return {
      state: 'SYNC_PENDING',
      label: 'Sync pending',
      remoteConfigured: true,
      attentionRequired: false,
    };
  }
  return {
    state: 'SYNCED',
    label: 'Synced',
    remoteConfigured: true,
    attentionRequired: false,
  };
}
