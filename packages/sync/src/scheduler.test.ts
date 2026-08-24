import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutboxSyncService, OutboxSyncSummary } from './outboxSync';
import { AutomaticOutboxScheduler, type AutomaticOutboxSchedulerOptions } from './scheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('AutomaticOutboxScheduler', () => {
  it('reports the start of a real sync cycle before its result', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let resolveSync!: (value: OutboxSyncSummary) => void;
    const service = {
      syncOnce: vi.fn(
        () =>
          new Promise<OutboxSyncSummary>((resolve) => {
            resolveSync = resolve;
          }),
      ),
    } as unknown as OutboxSyncService;
    const options = {
      intervalMs: 1_000,
      onStart: () => events.push('start'),
      onResult: () => events.push('result'),
    } as AutomaticOutboxSchedulerOptions & { readonly onStart: () => void };

    const scheduler = new AutomaticOutboxScheduler(service, options);

    scheduler.start();
    await vi.waitFor(() => expect(events).toEqual(['start']));

    resolveSync({
      attempted: 0,
      delivered: 0,
      failed: 0,
      quarantined: 0,
      dependencyBlocked: 0,
      blockedUntil: null,
      lastError: null,
    });
    await vi.waitFor(() => expect(events).toEqual(['start', 'result']));

    scheduler.stop();
  });
});
