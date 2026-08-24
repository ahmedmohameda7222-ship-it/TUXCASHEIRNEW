import { instant } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import { buildSyncHealth } from './syncHealth';

const cleanSummary = {
  attempted: 0,
  delivered: 0,
  failed: 0,
  quarantined: 0,
  dependencyBlocked: 0,
  blockedUntil: null,
  lastError: null,
} as const;

describe('buildSyncHealth', () => {
  it('never reports cloud success when no receiver is configured', () => {
    expect(
      buildSyncHealth({ remoteConfigured: false, hasRun: true, lastResult: cleanSummary }),
    ).toEqual({
      state: 'LOCAL_ONLY',
      label: 'Local only',
      remoteConfigured: false,
      attentionRequired: false,
    });
  });

  it('distinguishes pending, active, successful, retrying, and permanent issue states', () => {
    expect(buildSyncHealth({ remoteConfigured: true })).toMatchObject({ state: 'SYNC_PENDING' });
    expect(buildSyncHealth({ remoteConfigured: true, syncing: true })).toMatchObject({
      state: 'SYNCING',
    });
    expect(
      buildSyncHealth({ remoteConfigured: true, hasRun: true, lastResult: cleanSummary }),
    ).toMatchObject({ state: 'SYNCED' });
    expect(
      buildSyncHealth({
        remoteConfigured: true,
        hasRun: true,
        lastResult: {
          ...cleanSummary,
          failed: 1,
          blockedUntil: instant('2026-08-20T00:01:00.000Z'),
          lastError: 'timeout',
        },
      }),
    ).toMatchObject({ state: 'SYNC_RETRYING', attentionRequired: false });
    expect(
      buildSyncHealth({
        remoteConfigured: true,
        hasRun: true,
        lastResult: { ...cleanSummary, quarantined: 1, lastError: 'unsupported payload' },
      }),
    ).toMatchObject({ state: 'SYNC_ISSUE', attentionRequired: true });
  });

  it('treats a thrown sync error as a permanent visible sync issue', () => {
    expect(
      buildSyncHealth({
        remoteConfigured: true,
        hasRun: true,
        lastResult: new Error('transport unavailable'),
      }),
    ).toEqual({
      state: 'SYNC_ISSUE',
      label: 'Sync issue',
      remoteConfigured: true,
      attentionRequired: true,
    });
  });
});
