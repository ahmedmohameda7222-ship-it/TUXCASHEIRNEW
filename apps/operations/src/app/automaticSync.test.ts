import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import type { AutomaticOutboxSchedulerOptions, OutboxSyncSummary } from '@tux/sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  schedulerOptions: undefined as AutomaticOutboxSchedulerOptions | undefined,
  schedulerStarted: vi.fn(),
  inventorySyncShop: vi.fn(async (shopId: unknown) => {
    void shopId;
    return 0;
  }),
  lifecycleSyncShop: vi.fn(async (shopId: unknown) => {
    void shopId;
    return 0;
  }),
  markRemoteConfigured: vi.fn(),
  markSyncStarted: vi.fn(),
  markSyncFinished: vi.fn(),
}));

vi.mock('@tux/sync', () => ({
  AutomaticOutboxScheduler: class AutomaticOutboxScheduler {
    constructor(service: unknown, options?: AutomaticOutboxSchedulerOptions) {
      void service;
      harness.schedulerOptions = options;
    }

    start(): void {
      harness.schedulerStarted();
    }
  },
  HttpOutboxTransport: class HttpOutboxTransport {
    constructor(options: unknown) {
      void options;
    }
  },
  OutboxSyncService: class OutboxSyncService {
    constructor(database: unknown, transport: unknown, runtime: unknown) {
      void database;
      void transport;
      void runtime;
    }
  },
  HttpInventoryFeedTransport: class HttpInventoryFeedTransport {
    constructor(options: unknown) {
      void options;
    }
  },
  InventoryConvergenceService: class InventoryConvergenceService {
    constructor(database: unknown, transport: unknown) {
      void database;
      void transport;
    }

    syncShop(shopId: unknown): Promise<number> {
      return harness.inventorySyncShop(shopId);
    }
  },
  HttpOrderLifecycleFeedTransport: class HttpOrderLifecycleFeedTransport {
    constructor(options: unknown) {
      void options;
    }
  },
  OrderLifecycleConvergenceService: class OrderLifecycleConvergenceService {
    constructor(database: unknown, transport: unknown) {
      void database;
      void transport;
    }

    syncShop(shopId: unknown): Promise<number> {
      return harness.lifecycleSyncShop(shopId);
    }
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

    startBrowserAutomaticSync({
      database,
      now,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
    });

    expect(harness.inventorySyncShop).toHaveBeenCalledWith('14000000-0000-4000-8000-000000000001');
    expect(harness.markRemoteConfigured).toHaveBeenCalledTimes(1);
    expect(harness.schedulerStarted).toHaveBeenCalledTimes(1);

    harness.schedulerOptions?.onStart?.();
    expect(harness.markSyncStarted).toHaveBeenCalledTimes(1);

    harness.schedulerOptions?.onResult?.(cleanSummary);
    expect(harness.markSyncFinished).toHaveBeenCalledWith(cleanSummary);
  });

  it('reconciles canonical reward claims against durable local checkout intents at startup', async () => {
    const getByIdempotencyKey = vi.fn(async (_shopId: unknown, checkoutIntentId: string) =>
      checkoutIntentId === 'committed-intent' ? ({ id: 'order-1' } as never) : null,
    );
    const database = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({ orders: { getByIdempotencyKey } }),
    } as unknown as OperationsDatabase;
    const reconcileClaims = vi.fn(
      async (
        shopId: unknown,
        hasCommittedCheckoutIntent: (checkoutIntentId: string) => Promise<boolean>,
      ) => {
        expect(shopId).toBe('14000000-0000-4000-8000-000000000001');
        await expect(hasCommittedCheckoutIntent('committed-intent')).resolves.toBe(true);
        await expect(hasCommittedCheckoutIntent('abandoned-intent')).resolves.toBe(false);
      },
    );

    startBrowserAutomaticSync({
      database,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
      rewardClaims: { reconcileClaims },
    });

    await vi.waitFor(() => expect(getByIdempotencyKey).toHaveBeenCalledTimes(2));
    expect(reconcileClaims).toHaveBeenCalledTimes(1);
  });
  it('only reconciles a canonical claim when the durable local order carries the same reservation', async () => {
    const getByIdempotencyKey = vi.fn(
      async () =>
        ({
          id: 'order-without-this-reward',
          rewardReservationId: '99999999-9999-4999-8999-999999999999',
        }) as never,
    );
    const database = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({ orders: { getByIdempotencyKey } }),
    } as unknown as OperationsDatabase;
    const reconcileClaims = vi.fn(
      async (
        _shopId: unknown,
        hasCommittedRewardReservation: (
          checkoutIntentId: string,
          reservationId: string,
        ) => Promise<boolean>,
      ) => {
        await expect(
          hasCommittedRewardReservation('same-intent', '22222222-2222-4222-8222-222222222222'),
        ).resolves.toBe(false);
      },
    );

    startBrowserAutomaticSync({
      database,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
      rewardClaims: { reconcileClaims } as never,
    });

    await vi.waitFor(() => expect(reconcileClaims).toHaveBeenCalledTimes(1));
  });

  it('retries reward-claim reconciliation on the periodic remote sync interval', async () => {
    const intervalCallbacks: Array<() => void> = [];
    vi.stubGlobal('window', {
      location: { origin: 'https://operations.example.test' },
      setInterval: (callback: () => void) => {
        intervalCallbacks.push(callback);
        return 1;
      },
    });

    const database = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({ orders: { getByIdempotencyKey: async () => null } }),
    } as unknown as OperationsDatabase;
    const reconcileClaims = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary reconcile failure'))
      .mockResolvedValue(undefined);

    startBrowserAutomaticSync({
      database,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
      rewardClaims: { reconcileClaims },
    });

    await vi.waitFor(() => expect(reconcileClaims).toHaveBeenCalledTimes(1));
    expect(intervalCallbacks).toHaveLength(1);
    intervalCallbacks[0]?.();
    await vi.waitFor(() => expect(reconcileClaims).toHaveBeenCalledTimes(2));
  });
});
