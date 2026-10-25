import type { Instant } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import type { AutomaticOutboxSchedulerOptions, OutboxSyncSummary } from '@tux/sync';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  outboxTransportOptions: undefined as
    | {
        onOrderDependencyMissing?: (event: unknown, orderId: string) => Promise<void>;
      }
    | undefined,
  schedulerOptions: undefined as AutomaticOutboxSchedulerOptions | undefined,
  schedulerStarted: vi.fn(),
  schedulerStopped: vi.fn(),
  schedulerTriggered: vi.fn(),
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
  recoverMissingBusinessDayStart: vi.fn(async () => 'RECONSTRUCTED' as const),
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
    stop(): void {
      harness.schedulerStopped();
    }
    trigger(): void {
      harness.schedulerTriggered();
    }
  },
  HttpOutboxTransport: class HttpOutboxTransport {
    constructor(options: unknown) {
      harness.outboxTransportOptions = options as typeof harness.outboxTransportOptions;
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
    setOnline: vi.fn(),
  },
}));

vi.mock('./businessDayStartRecovery', () => ({
  recoverMissingBusinessDayStart: harness.recoverMissingBusinessDayStart,
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
  pendingCount: 0,
  quarantinedCount: 0,
  nextRetryAt: null,
  lastSuccessfulDeliveryAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.schedulerOptions = undefined;
  harness.outboxTransportOptions = undefined;
  vi.stubGlobal('window', { location: { origin: 'https://operations.example.test' } });
});

describe('startBrowserAutomaticSync', () => {
  it('replays a delivered order placement when the server reports its order dependency missing', async () => {
    const recoverMissingOrderPlacement = vi.fn(async () => 'RECOVERED' as const);
    const database = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({
          outbox: {
            recoverMissingOrderPlacement,
            getDeliveryStatus: async () => ({
              pendingCount: 0,
              quarantinedCount: 0,
              nextAttemptAt: null,
              lastError: null,
              lastSuccessfulDeliveryAt: null,
            }),
          },
        }),
    } as unknown as OperationsDatabase;
    const orderId = '52000000-0000-4000-8000-000000000001';

    startBrowserAutomaticSync({
      database,
      now: () => '2026-10-25T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
    });
    await harness.outboxTransportOptions?.onOrderDependencyMissing?.({}, orderId);

    expect(recoverMissingOrderPlacement).toHaveBeenCalledWith(orderId);
  });

  it('recovers a previously reported missing Business Day origin immediately at startup', async () => {
    const shopId = '14000000-0000-4000-8000-000000000001';
    const businessDayId = '7a73d78c-7f7f-4288-aa41-ef7a5b3be0b6';
    const database = {
      transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work({
          outbox: {
            getDeliveryStatus: async () => ({
              pendingCount: 5,
              quarantinedCount: 0,
              nextAttemptAt: '2026-10-24T23:37:38.251Z',
              lastError: `Business Day ${businessDayId} has not materialized. Retry after the original Business Day start event is synchronized; preserve the outbox.`,
              lastSuccessfulDeliveryAt: null,
            }),
          },
        }),
    } as unknown as OperationsDatabase;

    startBrowserAutomaticSync({
      database,
      now: () => '2026-10-24T23:33:00.000Z' as Instant,
      shopId: shopId as never,
    });

    await vi.waitFor(() => expect(harness.recoverMissingBusinessDayStart).toHaveBeenCalledTimes(1));
    expect(harness.recoverMissingBusinessDayStart).toHaveBeenCalledWith(
      expect.objectContaining({ database, businessDayId, shopId }),
    );
    expect(harness.schedulerTriggered).toHaveBeenCalledTimes(1);
  });

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

  it('ignores an in-flight sync completion from a shop that has signed out', () => {
    const handle = startBrowserAutomaticSync({
      database: {} as OperationsDatabase,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
    });
    const priorOnStart = harness.schedulerOptions?.onStart;
    const priorOnResult = harness.schedulerOptions?.onResult;
    handle.stop();

    priorOnStart?.();
    priorOnResult?.(cleanSummary);

    expect(harness.markSyncStarted).not.toHaveBeenCalled();
    expect(harness.markSyncFinished).not.toHaveBeenCalled();
  });

  it('tears down shop-scoped timers and listeners when the authenticated shop ends', () => {
    const callbacks: Array<() => void> = [];
    const setIntervalMock = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return 41;
    });
    const clearIntervalMock = vi.fn();
    const listeners = new Map<string, () => void>();
    const removeEventListener = vi.fn((name: string) => listeners.delete(name));
    vi.stubGlobal('window', {
      location: { origin: 'https://operations.example.test' },
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener,
    });
    vi.stubGlobal('navigator', { onLine: true });
    const handle = startBrowserAutomaticSync({
      database: {} as OperationsDatabase,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
    });
    expect(listeners.has('online')).toBe(true);
    const priorCalls = harness.inventorySyncShop.mock.calls.length;
    handle.stop();
    expect(harness.schedulerStopped).toHaveBeenCalledTimes(1);
    expect(clearIntervalMock).toHaveBeenCalledWith(41);
    expect(removeEventListener).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('offline', expect.any(Function));
    callbacks[0]?.();
    expect(harness.inventorySyncShop.mock.calls.length).toBe(priorCalls);
  });

  it('triggers an immediate outbox delivery pass when connectivity returns', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      location: { origin: 'https://operations.example.test' },
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('navigator', { onLine: false });
    startBrowserAutomaticSync({
      database: {} as OperationsDatabase,
      now: () => '2026-08-24T06:00:00.000Z' as Instant,
      shopId: '14000000-0000-4000-8000-000000000001' as never,
    });
    harness.schedulerTriggered.mockClear();

    listeners.get('online')?.();

    expect(harness.schedulerTriggered).toHaveBeenCalledTimes(1);
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
