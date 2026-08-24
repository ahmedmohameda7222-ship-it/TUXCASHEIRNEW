import { describe, expect, it } from 'vitest';
import { assertSyncHealthSnapshot } from './syncStatusResult';

const snapshots = [
  {
    state: 'LOCAL_ONLY',
    label: 'Local only',
    remoteConfigured: false,
    attentionRequired: false,
  },
  {
    state: 'SYNC_PENDING',
    label: 'Sync pending',
    remoteConfigured: true,
    attentionRequired: false,
  },
  {
    state: 'SYNCING',
    label: 'Syncing',
    remoteConfigured: true,
    attentionRequired: false,
  },
  {
    state: 'SYNCED',
    label: 'Synced',
    remoteConfigured: true,
    attentionRequired: false,
  },
  {
    state: 'SYNC_RETRYING',
    label: 'Sync retrying',
    remoteConfigured: true,
    attentionRequired: false,
  },
  {
    state: 'SYNC_ISSUE',
    label: 'Sync issue',
    remoteConfigured: true,
    attentionRequired: true,
  },
] as const;

describe('assertSyncHealthSnapshot', () => {
  it('accepts every closed sync-health state', () => {
    for (const snapshot of snapshots) {
      expect(assertSyncHealthSnapshot(snapshot)).toEqual(snapshot);
    }
  });

  it('rejects unknown states and malformed fields', () => {
    expect(() =>
      assertSyncHealthSnapshot({
        state: 'ONLINE',
        label: 'Online',
        remoteConfigured: true,
        attentionRequired: false,
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertSyncHealthSnapshot({
        state: 'SYNCED',
        label: 'Everything is fine',
        remoteConfigured: true,
        attentionRequired: false,
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertSyncHealthSnapshot({
        state: 'SYNCED',
        label: 'Synced',
        remoteConfigured: 'yes',
        attentionRequired: false,
      }),
    ).toThrow(TypeError);
    expect(() => assertSyncHealthSnapshot(null)).toThrow(TypeError);
  });
});
