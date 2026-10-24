import type { Instant } from '@tux/domain';
import type { OutboxSyncSummary } from './outboxSync';

export type SyncHealthState =
  'LOCAL_ONLY' | 'OFFLINE' | 'SYNC_PENDING' | 'SYNCING' | 'SYNCED' | 'SYNC_RETRYING' | 'SYNC_ISSUE';

export interface SyncHealthSnapshot {
  readonly state: SyncHealthState;
  readonly label:
    | 'Local only'
    | 'Offline'
    | 'Sync pending'
    | 'Syncing'
    | 'Synced'
    | 'Sync retrying'
    | 'Sync issue';
  readonly remoteConfigured: boolean;
  readonly attentionRequired: boolean;
  readonly pendingCount: number;
  readonly lastSuccessfulDeliveryAt: Instant | null;
  readonly lastError: string | null;
  readonly nextRetryAt: Instant | null;
  readonly detail?: string;
}

function diagnostics(
  result: OutboxSyncSummary | Error | null,
): Pick<
  SyncHealthSnapshot,
  'pendingCount' | 'lastSuccessfulDeliveryAt' | 'lastError' | 'nextRetryAt'
> {
  if (result === null || result instanceof Error) {
    return {
      pendingCount: 0,
      lastSuccessfulDeliveryAt: null,
      lastError: null,
      nextRetryAt: null,
    };
  }
  return {
    pendingCount: result.pendingCount,
    lastSuccessfulDeliveryAt: result.lastSuccessfulDeliveryAt,
    lastError: result.lastError,
    nextRetryAt: result.nextRetryAt,
  };
}

export function buildSyncHealth(input: {
  readonly remoteConfigured: boolean;
  readonly online?: boolean;
  readonly syncing?: boolean;
  readonly hasRun?: boolean;
  readonly lastResult?: OutboxSyncSummary | Error | null;
}): SyncHealthSnapshot {
  const result = input.lastResult ?? null;
  const delivery = diagnostics(result);
  if (!input.remoteConfigured) {
    return {
      state: 'LOCAL_ONLY',
      label: 'Local only',
      remoteConfigured: false,
      attentionRequired: false,
      ...delivery,
    };
  }
  if (input.online === false) {
    return {
      state: 'OFFLINE',
      label: 'Offline',
      remoteConfigured: true,
      attentionRequired: false,
      ...delivery,
    };
  }
  if (input.syncing) {
    return {
      state: 'SYNCING',
      label: 'Syncing',
      remoteConfigured: true,
      attentionRequired: false,
      ...delivery,
    };
  }
  if (result instanceof Error) {
    return {
      state: 'SYNC_ISSUE',
      label: 'Sync issue',
      remoteConfigured: true,
      attentionRequired: true,
      ...delivery,
    };
  }
  if (result?.quarantinedCount || result?.quarantined) {
    return {
      state: 'SYNC_ISSUE',
      label: 'Sync issue',
      remoteConfigured: true,
      attentionRequired: true,
      ...delivery,
      ...(result.lastError === null ? {} : { detail: result.lastError }),
    };
  }
  if (result?.failed || (result?.pendingCount && result.lastError !== null)) {
    return {
      state: 'SYNC_RETRYING',
      label: 'Sync retrying',
      remoteConfigured: true,
      attentionRequired: false,
      ...delivery,
    };
  }
  if (!input.hasRun || (result?.pendingCount ?? 0) > 0) {
    return {
      state: 'SYNC_PENDING',
      label: 'Sync pending',
      remoteConfigured: true,
      attentionRequired: false,
      ...delivery,
    };
  }
  return {
    state: 'SYNCED',
    label: 'Synced',
    remoteConfigured: true,
    attentionRequired: false,
    ...delivery,
  };
}
