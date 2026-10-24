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
  pendingCount: 0,
  quarantinedCount: 0,
  nextRetryAt: null,
  lastSuccessfulDeliveryAt: null,
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

  it('shows SYNC_PENDING only after a configured remote waits 400 ms for its first cycle', async () => {
    vi.useFakeTimers();
    const store = createSyncStatusStore({ visibilityDelayMs: 400 });

    store.markRemoteConfigured();

    await vi.advanceTimersByTimeAsync(399);
    expect(store.getSnapshot().state).toBe('LOCAL_ONLY');

    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().state).toBe('SYNC_PENDING');
  });

  it('reports Offline only from navigator connectivity and Retrying for an online delivery error', () => {
    const store = createSyncStatusStore({ visibilityDelayMs: 0 });
    store.markRemoteConfigured();
    store.setOnline(true);
    store.markSyncFinished({
      ...cleanSummary,
      failed: 1,
      pendingCount: 2,
      lastError: 'Remote outbox endpoint rejected event with HTTP 401.',
      nextRetryAt: '2026-08-24T06:00:02.000Z' as never,
    });
    expect(store.getSnapshot()).toMatchObject({
      state: 'SYNC_RETRYING',
      pendingCount: 2,
      lastError: 'Remote outbox endpoint rejected event with HTTP 401.',
    });

    store.setOnline(false);
    expect(store.getSnapshot()).toMatchObject({ state: 'OFFLINE', pendingCount: 2 });
  });
});
