import type { TuxWhatsAppApi } from '@tux/platform-contracts';
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

import { WhatsAppIpcRuntime } from './whatsappIpc';

const conversationId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const channels = [
  'tux:whatsapp:load-inbox',
  'tux:whatsapp:load-conversation',
  'tux:whatsapp:send-text',
  'tux:whatsapp:mark-unread',
  'tux:whatsapp:archive',
  'tux:whatsapp:set-follow-up',
  'tux:whatsapp:link-order',
  'tux:whatsapp:save-draft',
  'tux:whatsapp:get-draft',
  'tux:whatsapp:resolve-customer-order-context',
] as const;

function service(): TuxWhatsAppApi {
  return {
    loadInbox: vi.fn(async () => ({
      ok: true,
      value: {
        conversations: [],
        messages: [],
        quickReplies: [],
        orderLinks: [],
        nextCursor: null,
      },
    })) as never,
    loadConversation: vi.fn(async () => ({ ok: true, value: [] })) as never,
    sendText: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'not used' },
    })) as never,
    markUnread: vi.fn(async () => ({ ok: true, value: undefined })) as never,
    archive: vi.fn(async () => ({ ok: true, value: undefined })) as never,
    setFollowUp: vi.fn(async () => ({ ok: true, value: undefined })) as never,
    linkOrder: vi.fn(async () => ({ ok: true, value: undefined })) as never,
    saveDraft: vi.fn(async () => ({ ok: true, value: undefined })) as never,
    getDraft: vi.fn(async () => ({ ok: true, value: null })) as never,
    resolveCustomerOrderContext: vi.fn(async () => ({
      ok: true,
      value: {
        kind: 'NO_ACTIVE_ORDER',
        customer: {
          normalizedPhone: '01012345678',
          displayPhone: '+201012345678',
          customerName: 'Customer',
          address: null,
          zoneId: null,
        },
        activeOrders: [],
      },
    })) as never,
  };
}

function register(input = service()) {
  const runtime = new WhatsAppIpcRuntime({ service: input });
  runtime.register({ webContents: { id: 77 } } as never);
  return { runtime, service: input };
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

describe('WhatsAppIpcRuntime', () => {
  it('registers exactly all ten WhatsApp channels', () => {
    register();
    expect([...electron.handlers.keys()]).toEqual(channels);
  });

  it('checks trusted sender before invoking every service method', async () => {
    const api = service();
    register(api);
    const event = { sender: { id: 77 } };
    const cases: readonly [string, keyof TuxWhatsAppApi, readonly unknown[]][] = [
      [channels[0], 'loadInbox', ['cursor']],
      [channels[1], 'loadConversation', [conversationId]],
      [channels[2], 'sendText', [{ conversationId, outboundIntentKey: 'intent-1', text: 'hello' }]],
      [channels[3], 'markUnread', [conversationId]],
      [channels[4], 'archive', [conversationId, true]],
      [channels[5], 'setFollowUp', [conversationId, true]],
      [channels[6], 'linkOrder', [{ conversationId, orderId, linked: true }]],
      [channels[7], 'saveDraft', [conversationId, '']],
      [channels[8], 'getDraft', [conversationId]],
      [channels[9], 'resolveCustomerOrderContext' as keyof TuxWhatsAppApi, [conversationId]],
    ];

    for (const [channel, method, args] of cases) {
      security.assertTrustedIpcSender.mockClear();
      const target = api[method] as unknown as ReturnType<typeof vi.fn>;
      target.mockClear();
      await handler(channel)(event, ...args);
      expect(security.assertTrustedIpcSender).toHaveBeenCalledWith(event, 77);
      expect(target).toHaveBeenCalledTimes(1);
      expect(security.assertTrustedIpcSender.mock.invocationCallOrder[0]).toBeLessThan(
        target.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
    }
  });

  it.each([null, 1, {}, 'not-a-uuid'])(
    'rejects malformed loadConversation payload %p without invoking the service',
    async (value) => {
      const api = service();
      register(api);
      await expect(handler(channels[1])({}, value)).rejects.toThrow();
      expect(api.loadConversation).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    {},
    { conversationId: 'bad', outboundIntentKey: 'intent-1', text: 'hello' },
    { conversationId, outboundIntentKey: '', text: 'hello' },
    { conversationId, outboundIntentKey: 'intent-1', text: '   ' },
  ])('rejects malformed sendText payload %# without invoking the service', async (value) => {
    const api = service();
    register(api);
    await expect(handler(channels[2])({}, value)).rejects.toThrow();
    expect(api.sendText).not.toHaveBeenCalled();
  });

  it('rejects non-boolean archive and follow-up flags without invoking the service', async () => {
    const api = service();
    register(api);
    await expect(handler(channels[4])({}, conversationId, 'yes')).rejects.toThrow();
    await expect(handler(channels[5])({}, conversationId, 1)).rejects.toThrow();
    expect(api.archive).not.toHaveBeenCalled();
    expect(api.setFollowUp).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { conversationId: 'bad', orderId, linked: true },
    { conversationId, orderId: 'bad', linked: true },
    { conversationId, orderId, linked: 'yes' },
  ])('rejects malformed linkOrder payload %# without invoking the service', async (value) => {
    const api = service();
    register(api);
    await expect(handler(channels[6])({}, value)).rejects.toThrow();
    expect(api.linkOrder).not.toHaveBeenCalled();
  });

  it('permits an empty draft string but rejects malformed draft arguments', async () => {
    const api = service();
    register(api);
    await handler(channels[7])({}, conversationId, '');
    expect(api.saveDraft).toHaveBeenCalledWith(conversationId, '');
    await expect(handler(channels[7])({}, 'bad', '')).rejects.toThrow();
    await expect(handler(channels[7])({}, conversationId, 1)).rejects.toThrow();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('validates getDraft conversationId before invoking the service', async () => {
    const api = service();
    register(api);
    await expect(handler(channels[8])({}, 'bad')).rejects.toThrow();
    expect(api.getDraft).not.toHaveBeenCalled();
  });

  it('validates customer-order context conversationId before invoking the service', async () => {
    const api = service() as TuxWhatsAppApi & {
      resolveCustomerOrderContext: ReturnType<typeof vi.fn>;
    };
    register(api as TuxWhatsAppApi);
    await expect(handler(channels[9])({}, 'bad')).rejects.toThrow();
    expect(api.resolveCustomerOrderContext).not.toHaveBeenCalled();
  });

  it('removes every WhatsApp handler on close', () => {
    const { runtime } = register();
    runtime.close();
    expect([...electron.handlers.keys()]).toEqual([]);
    for (const channel of channels) expect(electron.removeHandler).toHaveBeenCalledWith(channel);
  });
});
