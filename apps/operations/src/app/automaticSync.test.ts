import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import type { AutomaticOutboxSchedulerOptions, OutboxSyncSummary } from '@tux/sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  schedulerOptions: undefined as AutomaticOutboxSchedulerOptions | undefined,
  schedulerStarted: vi.fn(),
  markRemoteConfigured: vi.fn(),
  markSyncStarted: vi.fn(),
  markSyncFinished: vi.fn(),
}));

vi.mock('@tux/sync', () => ({
  AutomaticOutboxScheduler: class AutomaticOutboxScheduler {
    constructor(_service: unknown, options?: AutomaticOutboxSchedulerOptions) {
      harness.schedulerOptions = options;
    }

    start(): void {
      harness.schedulerStarted();
    }
  },
  HttpOutboxTransport: class HttpOutboxTransport {
    constructor(_options: unknown) {}
  },
  OutboxSyncService: class OutboxSyncService {
    constructor(_database: unknown, _transport: unknown, _runtime: unknown) {}
  },
}));

vi.mock('./syncStatus', () => ({
  browserSyncStatusStore: {
    markRemoteConfigured: harness.markRemoteConfigured,
    markSyncStarted: harness.markSyncStarted,
    markSyncFinished: harness.markSyncFinished,
  },
}));

import { startBrowserAutomaticSync } from './automaticSync';

const cleanSummary: OutboxSyncSummary = {
  attempted: 0,
  delivered: 0,
  failed: 0,
  quarantined: 0,
  dependencyBlocked: 0,
  blockedUntil: null,
  lastError: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.schedulerOptions = undefined;
  vi.stubGlobal('window', { location: { origin: 'https://operations.example.test' } });
});

describe('startBrowserAutomaticSync', () => {
  it('feeds real scheduler lifecycle events into the browser sync status store', () => {
    const database = {} as OperationsDatabase;
    const now = () => '2026-08-24T06:00:00.000Z' as Instant;

    startBrowserAutomaticSync({ database, now });

    expect(harness.markRemoteConfigured).toHaveBeenCalledTimes(1);
    expect(harness.schedulerStarted).toHaveBeenCalledTimes(1);

    harness.schedulerOptions?.onStart?.();
    expect(harness.markSyncStarted).toHaveBeenCalledTimes(1);

    harness.schedulerOptions?.onResult?.(cleanSummary);
    expect(harness.markSyncFinished).toHaveBeenCalledWith(cleanSummary);
  });
});
