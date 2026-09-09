import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };
});
const security = vi.hoisted(() => ({ assertTrustedIpcSender: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('./security', () => security);

import {
  IPC_ONLINE_ORDERS_ACCEPT,
  IPC_ONLINE_ORDERS_REJECT,
  OnlineOrderInboxIpcRuntime,
} from './onlineOrderInboxIpc';

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const value = electron.handlers.get(channel);
  if (value === undefined) throw new Error(`missing handler ${channel}`);
  return value as (...args: unknown[]) => Promise<unknown>;
}

beforeEach(() => {
  electron.handlers.clear();
  electron.handle.mockClear();
  electron.removeHandler.mockClear();
  security.assertTrustedIpcSender.mockReset();
});

describe('desktop online-order mutation serialization', () => {
  it('does not allow rejection to pass acceptance for the same request', async () => {
    const acceptanceDeferred = deferred<{ ok: true; value: { order: { id: string } } }>();
    let committed = false;
    const request = {
      requestId: REQUEST_ID,
      shopId: SHOP_ID,
      status: 'PROCESSING',
      catalogRevision: 'a'.repeat(64),
      fulfillmentPreference: 'PICKUP',
      paymentPreference: 'CASH',
      customerName: 'Customer',
      normalizedPhone: null,
      deliveryAddress: null,
      trustedItems: [{ productId: '55555555-5555-4555-8555-555555555555', quantity: 1 }],
      itemsSubtotalMinor: 19000,
      orderNote: null,
      createdAt: '2026-09-08T10:00:00.000Z',
      processingOrderId: PROCESSING_ORDER_ID,
      processingStartedAt: '2026-09-08T10:01:00.000Z',
      processingExpiresAt: '2026-09-08T22:01:00.000Z',
    };
    const service = {
      load: vi.fn(),
      claim: vi.fn(),
      release: vi.fn(),
      reject: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => () => undefined),
    };
    const acceptance = {
      accept: vi.fn(async () => {
        const result = await acceptanceDeferred.promise;
        committed = true;
        return result;
      }),
    };
    const acceptanceStore = {
      list: vi.fn().mockResolvedValue([request]),
      get: vi.fn().mockResolvedValue(request),
      markAccepted: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = new OnlineOrderInboxIpcRuntime({
      service: service as never,
      acceptance: acceptance as never,
      acceptanceStore: acceptanceStore as never,
      getActiveShopId: vi.fn().mockResolvedValue(SHOP_ID),
      findCommittedOnlineOrder: vi.fn(async () => committed),
    });
    runtime.register({ isDestroyed: () => false, webContents: { id: 77, send: vi.fn() } } as never);
    const event = { sender: { id: 77 } };
    const confirmation = {
      orderTypeId: '77777777-7777-4777-8777-777777777777',
      deliveryZoneId: null,
      finalDeliveryFeeMinor: null,
      payment: {
        mode: 'SINGLE',
        methodId: '88888888-8888-4888-8888-888888888888',
        cashReceivedMinor: 20000,
      },
    };

    const acceptPromise = handler(IPC_ONLINE_ORDERS_ACCEPT)(event, {
      requestId: REQUEST_ID,
      confirmation,
    });
    await vi.waitFor(() => expect(acceptance.accept).toHaveBeenCalledTimes(1));

    const rejectPromise = handler(IPC_ONLINE_ORDERS_REJECT)(event, {
      requestId: REQUEST_ID,
      processingOrderId: PROCESSING_ORDER_ID,
      reason: 'No stock',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(service.reject).not.toHaveBeenCalled();

    acceptanceDeferred.resolve({ ok: true, value: { order: { id: PROCESSING_ORDER_ID } } });
    await expect(acceptPromise).resolves.toMatchObject({ ok: true });
    await expect(rejectPromise).rejects.toThrow('already been accepted locally');
    expect(service.reject).not.toHaveBeenCalled();
  });
});
