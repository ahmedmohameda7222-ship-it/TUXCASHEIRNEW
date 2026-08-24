import type { TuxSyncHealthSnapshot } from '@tux/platform-contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assertSyncHealthSnapshot(value: unknown): TuxSyncHealthSnapshot {
  if (!isRecord(value) || typeof value['state'] !== 'string') {
    throw new TypeError('Invalid sync status response from Electron main process.');
  }

  const expected = (() => {
    switch (value['state']) {
      case 'LOCAL_ONLY':
        return { label: 'Local only', remoteConfigured: false, attentionRequired: false } as const;
      case 'SYNC_PENDING':
        return { label: 'Sync pending', remoteConfigured: true, attentionRequired: false } as const;
      case 'SYNCING':
        return { label: 'Syncing', remoteConfigured: true, attentionRequired: false } as const;
      case 'SYNCED':
        return { label: 'Synced', remoteConfigured: true, attentionRequired: false } as const;
      case 'SYNC_RETRYING':
        return { label: 'Sync retrying', remoteConfigured: true, attentionRequired: false } as const;
      case 'SYNC_ISSUE':
        return { label: 'Sync issue', remoteConfigured: true, attentionRequired: true } as const;
      default:
        return null;
    }
  })();

  if (
    expected === null ||
    value['label'] !== expected.label ||
    value['remoteConfigured'] !== expected.remoteConfigured ||
    value['attentionRequired'] !== expected.attentionRequired
  ) {
    throw new TypeError('Invalid sync status response from Electron main process.');
  }

  return value as unknown as TuxSyncHealthSnapshot;
}
