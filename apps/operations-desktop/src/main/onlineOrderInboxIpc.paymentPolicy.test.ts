import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
  };
});
const security = vi.hoisted(() => ({ assertTrustedIpcSender: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
}));
vi.mock('./security', () => security);

import { IPC_ONLINE_ORDERS_ACCEPT, OnlineOrderInboxIpcRuntime } from './onlineOrderInboxIpc';

const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const PROCESSING_ORDER_ID = '66666666-6666-4666-8666-666666666666';
const METHOD_ID = '88888888-8888-4888-8888-888888888888';

beforeEach(() => {
  electron.handlers.clear();
  electron.handle.mockClear();
  electron.removeHandler.mockClear();
  security.assertTrustedIpcSender.mockReset();
});

describe('online-order acceptance payment IPC', () => {
  it('forwards canonical reference and manual confirmation evidence', async () => {
    const service = {
      load: vi.fn(),
      claim: vi.fn(),
      release: vi.fn(),
      reject: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    };
    const request = {
      requestId: REQUEST_ID,
      shopId: SHOP_ID,
      status: 'PROCESSING',
      processingOrderId: PROCESSING_ORDER_ID,
    };
    const acceptance = { accept: vi.fn().mockResolvedValue({ ok: false }) };
    const acceptanceStore = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(request),
      markAccepted: vi.fn(),
    };
    const runtime = new OnlineOrderInboxIpcRuntime({
      service: service as never,
      acceptance: acceptance as never,
      acceptanceStore: acceptanceStore as never,
      getActiveShopId: vi.fn().mockResolvedValue(SHOP_ID) as never,
    });
    runtime.register({ isDestroyed: () => false, webContents: { id: 77, send: vi.fn() } } as never);

    const handler = electron.handlers.get(IPC_ONLINE_ORDERS_ACCEPT);
    if (handler === undefined) throw new Error('acceptance handler missing');
    await handler(
      { sender: { id: 77 } },
      {
        requestId: REQUEST_ID,
        confirmation: {
          orderTypeId: '77777777-7777-4777-8777-777777777777',
          deliveryZoneId: null,
          finalDeliveryFeeMinor: null,
          payment: {
            mode: 'SINGLE',
            methodId: METHOD_ID,
            cashReceivedMinor: null,
            reference: 'AUTH-42',
            manualConfirmed: true,
          },
        },
      },
    );

    expect(acceptance.accept).toHaveBeenCalledTimes(1);
    expect(acceptance.accept.mock.calls[0]?.[1]).toMatchObject({
      payment: {
        mode: 'SINGLE',
        methodId: METHOD_ID,
        reference: 'AUTH-42',
        manualConfirmed: true,
      },
    });
    runtime.close();
  });
});
