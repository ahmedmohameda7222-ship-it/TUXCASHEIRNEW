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
      pendingCount: 0,
      quarantinedCount: 0,
      nextRetryAt: null,
      lastSuccessfulDeliveryAt: null,
    });
    await vi.waitFor(() => expect(events).toEqual(['start', 'result']));

    scheduler.stop();
  });

  it('coalesces a reconnect trigger behind an in-flight pass without overlapping deliveries', async () => {
    const resolvers: Array<(value: OutboxSyncSummary) => void> = [];
    const service = {
      syncOnce: vi.fn(
        () =>
          new Promise<OutboxSyncSummary>((resolve) => {
            resolvers.push(resolve);
          }),
      ),
    } as unknown as OutboxSyncService;
    const scheduler = new AutomaticOutboxScheduler(service, { intervalMs: 60_000 });

    scheduler.start();
    expect(service.syncOnce).toHaveBeenCalledTimes(1);
    scheduler.trigger();
    expect(service.syncOnce).toHaveBeenCalledTimes(1);

    resolvers[0]?.({
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
    });
    await vi.waitFor(() => expect(service.syncOnce).toHaveBeenCalledTimes(2));

    scheduler.stop();
  });
});
