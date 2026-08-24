import type { OutboxSyncSummary } from '@tux/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncStatusStore } from './syncStatus';

const cleanSummary: OutboxSyncSummary = {
  attempted: 0,
  delivered: 0,
  failed: 0,
  quarantined: 0,
  dependencyBlocked: 0,
  blockedUntil: null,
  lastError: null,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('renderer sync status store', () => {
  it('suppresses a fast sync cycle instead of flashing SYNCING', async () => {
    vi.useFakeTimers();
    const store = createSyncStatusStore({ visibilityDelayMs: 400 });

    store.markRemoteConfigured();
    store.markSyncStarted();
    expect(store.getSnapshot().state).toBe('LOCAL_ONLY');

    store.markSyncFinished(cleanSummary);
    expect(store.getSnapshot().state).toBe('SYNCED');

    await vi.advanceTimersByTimeAsync(400);
    expect(store.getSnapshot().state).toBe('SYNCED');
  });

  it('shows SYNCING only after a slow cycle remains active for 400 ms', async () => {
    vi.useFakeTimers();
    const store = createSyncStatusStore({ visibilityDelayMs: 400 });

    store.markRemoteConfigured();
    store.markSyncStarted();

    await vi.advanceTimersByTimeAsync(399);
    expect(store.getSnapshot().state).toBe('LOCAL_ONLY');

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().state).toBe('SYNCING');
  });
});
