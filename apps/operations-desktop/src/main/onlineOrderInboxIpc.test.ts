import type { OnlineOrderInboxSnapshot } from '@tux/application';
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
  ipcMain: {
    handle: electron.handle,
    removeHandler: electron.removeHandler,
  },
}));
vi.mock('./security', () => security);

import {
  IPC_ONLINE_ORDERS_ACCEPT,
  IPC_ONLINE_ORDERS_CHANGED,
  IPC_ONLINE_ORDERS_CLAIM,
  IPC_ONLINE_ORDERS_LOAD,
  IPC_ONLINE_ORDERS_REJECT,
  IPC_ONLINE_ORDERS_RELEASE,
  OnlineOrderInboxIpcRuntime,
} from './onlineOrderInboxIpc';

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';
const snapshot: OnlineOrderInboxSnapshot = {
  requests: [],
  syncState: 'SYNCED',
  errorMessage: null,
};

function service() {
  const listeners = new Set<(value: OnlineOrderInboxSnapshot) => void>();
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    claim: vi.fn().mockResolvedValue({ requestId: REQUEST_ID }),
    release: vi.fn().mockResolvedValue({ requestId: REQUEST_ID }),
    reject: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((listener: (value: OnlineOrderInboxSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    publish(value: OnlineOrderInboxSnapshot) {
      for (const listener of listeners) listener(value);
    },
  };
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

describe('OnlineOrderInboxIpcRuntime', () => {
  it('registers inbox and acceptance channels and checks the trusted sender before delegation', async () => {
    const inbox = service();
    const sent = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { id: 77, send: sent },
    };
    const runtime = new OnlineOrderInboxIpcRuntime({ service: inbox });
    runtime.register(window as never);

    expect([...electron.handlers.keys()]).toEqual([
      IPC_ONLINE_ORDERS_LOAD,
      IPC_ONLINE_ORDERS_CLAIM,
      IPC_ONLINE_ORDERS_RELEASE,
      IPC_ONLINE_ORDERS_REJECT,
      IPC_ONLINE_ORDERS_ACCEPT,
    ]);

    const event = { sender: { id: 77 } };
    await handler(IPC_ONLINE_ORDERS_LOAD)(event);
    await handler(IPC_ONLINE_ORDERS_CLAIM)(event, { requestId: REQUEST_ID });
    await handler(IPC_ONLINE_ORDERS_RELEASE)(event, {
      requestId: REQUEST_ID,
      processingOrderId: PROCESSING_ORDER_ID,
    });
    await handler(IPC_ONLINE_ORDERS_REJECT)(event, {
      requestId: REQUEST_ID,
      processingOrderId: PROCESSING_ORDER_ID,
      reason: 'Out of service area',
    });

    expect(security.assertTrustedIpcSender).toHaveBeenCalledTimes(4);
    expect(inbox.load).toHaveBeenCalledTimes(1);
    expect(inbox.claim).toHaveBeenCalledWith(REQUEST_ID);
    expect(inbox.release).toHaveBeenCalledWith(REQUEST_ID, PROCESSING_ORDER_ID);
    expect(inbox.reject).toHaveBeenCalledWith(
      REQUEST_ID,
      PROCESSING_ORDER_ID,
      'Out of service area',
    );

    inbox.publish(snapshot);
    expect(sent).toHaveBeenCalledWith(IPC_ONLINE_ORDERS_CHANGED, snapshot);
    runtime.close();
  });

  it('delegates acceptance only after trusted sender, request lookup, and exact payload validation', async () => {
    const inbox = service();
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
    const acceptance = {
      accept: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { order: { id: PROCESSING_ORDER_ID } } }),
    };
    const acceptanceStore = {
      get: vi.fn().mockResolvedValue(request),
      markAccepted: vi.fn().mockResolvedValue(undefined),
    };
    const getActiveShopId = vi.fn().mockResolvedValue(SHOP_ID);
    const runtime = new OnlineOrderInboxIpcRuntime({
      service: inbox,
      acceptance: acceptance as never,
      acceptanceStore: acceptanceStore as never,
      getActiveShopId: getActiveShopId as never,
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

    await handler(IPC_ONLINE_ORDERS_ACCEPT)(event, { requestId: REQUEST_ID, confirmation });
    expect(security.assertTrustedIpcSender).toHaveBeenCalledWith(event, 77);
    expect(getActiveShopId).toHaveBeenCalledTimes(1);
    expect(acceptanceStore.get).toHaveBeenCalledWith(SHOP_ID, REQUEST_ID);
    expect(acceptance.accept).toHaveBeenCalledTimes(1);
    expect(acceptance.accept.mock.calls[0]?.[0]).toBe(request);
    expect(acceptance.accept.mock.calls[0]?.[1]).toMatchObject({
      orderTypeId: confirmation.orderTypeId,
      payment: { mode: 'SINGLE', cashReceivedMinor: 20000 },
    });
    expect(acceptanceStore.markAccepted).toHaveBeenCalledWith(
      SHOP_ID,
      REQUEST_ID,
      PROCESSING_ORDER_ID,
    );
  });

  it('rejects malformed mutation payloads before calling the service', async () => {
    const inbox = service();
    const runtime = new OnlineOrderInboxIpcRuntime({ service: inbox });
    runtime.register({ isDestroyed: () => false, webContents: { id: 77, send: vi.fn() } } as never);
    const event = { sender: { id: 77 } };

    await expect(handler(IPC_ONLINE_ORDERS_CLAIM)(event, {})).rejects.toThrow(TypeError);
    await expect(
      handler(IPC_ONLINE_ORDERS_RELEASE)(event, {
        requestId: REQUEST_ID,
        processingOrderId: 'not-a-uuid',
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      handler(IPC_ONLINE_ORDERS_REJECT)(event, {
        requestId: REQUEST_ID,
        processingOrderId: PROCESSING_ORDER_ID,
        reason: '',
      }),
    ).rejects.toThrow(TypeError);

    expect(inbox.claim).not.toHaveBeenCalled();
    expect(inbox.release).not.toHaveBeenCalled();
    expect(inbox.reject).not.toHaveBeenCalled();
  });
});