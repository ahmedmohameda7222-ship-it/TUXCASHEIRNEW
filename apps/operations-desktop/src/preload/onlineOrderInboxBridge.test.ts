import type { OnlineOrderInboxSnapshot } from '@tux/application';
import type { CachedOnlineOrderRequest } from '@tux/persistence';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  exposed: null as unknown,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      harness.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: harness.invoke,
    on: harness.on,
    removeListener: harness.removeListener,
  },
}));

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';

const pendingRequest = {
  requestId: REQUEST_ID,
  shopId: SHOP_ID,
  status: 'PENDING',
  catalogRevision: 'a'.repeat(64),
  fulfillmentPreference: 'DELIVERY',
  paymentPreference: 'CASH',
  customerName: 'Online Customer',
  normalizedPhone: '01012345678',
  deliveryAddress: '12 Test Street',
  trustedItems: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 1 }],
  itemsSubtotalMinor: 12500,
  orderNote: null,
  createdAt: '2026-09-08T10:00:00.000Z',
  processingOrderId: null,
  processingStartedAt: null,
  processingExpiresAt: null,
} as const;

const processingRequest = {
  ...pendingRequest,
  status: 'PROCESSING',
  processingOrderId: PROCESSING_ORDER_ID,
  processingStartedAt: '2026-09-08T10:01:00.000Z',
  processingExpiresAt: '2026-09-08T10:11:00.000Z',
} as const;

const syncedSnapshot = {
  requests: [pendingRequest],
  syncState: 'SYNCED',
  errorMessage: null,
} as const;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  harness.exposed = null;
  await import('./index');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type OnlineOrdersApi = {
  readonly load: () => Promise<OnlineOrderInboxSnapshot>;
  readonly claim: (requestId: string) => Promise<CachedOnlineOrderRequest>;
  readonly release: (
    requestId: string,
    processingOrderId: string,
  ) => Promise<CachedOnlineOrderRequest>;
  readonly reject: (requestId: string, processingOrderId: string, reason: string) => Promise<void>;
  readonly subscribe: (listener: (snapshot: OnlineOrderInboxSnapshot) => void) => () => void;
};

function onlineOrdersApi(): OnlineOrdersApi {
  return (harness.exposed as { readonly onlineOrders?: OnlineOrdersApi })
    .onlineOrders as OnlineOrdersApi;
}

describe('desktop online-order inbox preload bridge', () => {
  it('uses explicit IPC channels for load, claim, release, reject, and validated notifications', async () => {
    harness.invoke.mockImplementation(async (channel: string) => {
      switch (channel) {
        case 'tux:online-orders:load':
          return syncedSnapshot;
        case 'tux:online-orders:claim':
          return processingRequest;
        case 'tux:online-orders:release':
          return pendingRequest;
        case 'tux:online-orders:reject':
          return undefined;
        default:
          throw new Error(`Unexpected IPC channel: ${channel}`);
      }
    });

    expect(await onlineOrdersApi().load()).toEqual(syncedSnapshot);
    expect(harness.invoke).toHaveBeenCalledWith('tux:online-orders:load');

    await expect(onlineOrdersApi().claim(REQUEST_ID)).resolves.toMatchObject({
      requestId: REQUEST_ID,
      status: 'PROCESSING',
    });
    expect(harness.invoke).toHaveBeenCalledWith('tux:online-orders:claim', {
      requestId: REQUEST_ID,
    });

    await expect(onlineOrdersApi().release(REQUEST_ID, PROCESSING_ORDER_ID)).resolves.toMatchObject(
      {
        requestId: REQUEST_ID,
        status: 'PENDING',
      },
    );
    expect(harness.invoke).toHaveBeenCalledWith('tux:online-orders:release', {
      requestId: REQUEST_ID,
      processingOrderId: PROCESSING_ORDER_ID,
    });

    await expect(
      onlineOrdersApi().reject(REQUEST_ID, PROCESSING_ORDER_ID, 'Customer cancelled'),
    ).resolves.toBeUndefined();
    expect(harness.invoke).toHaveBeenCalledWith('tux:online-orders:reject', {
      requestId: REQUEST_ID,
      processingOrderId: PROCESSING_ORDER_ID,
      reason: 'Customer cancelled',
    });

    const listener = vi.fn();
    const unsubscribe = onlineOrdersApi().subscribe(listener);
    expect(harness.on).toHaveBeenCalledTimes(1);
    expect(harness.on.mock.calls[0]?.[0]).toBe('tux:online-orders:changed');

    const wrapper = harness.on.mock.calls[0]?.[1] as (_event: unknown, value: unknown) => void;
    wrapper({}, syncedSnapshot);
    expect(listener).toHaveBeenCalledWith(syncedSnapshot);
    expect(() => wrapper({}, { requests: [], syncState: 'ONLINE', errorMessage: null })).toThrow(
      TypeError,
    );

    unsubscribe();
    expect(harness.removeListener).toHaveBeenCalledWith('tux:online-orders:changed', wrapper);
  });

  it('rejects malformed main-process response payloads before exposing them to the renderer', async () => {
    harness.invoke.mockResolvedValue({
      ...processingRequest,
      normalizedPhone: '+201012345678',
    });

    await expect(onlineOrdersApi().claim(REQUEST_ID)).rejects.toThrow(TypeError);
  });
});
