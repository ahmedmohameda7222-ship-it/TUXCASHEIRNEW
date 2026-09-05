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
const messageId = '33333333-3333-4333-8333-333333333333';
const channels = [
  'tux:whatsapp:load-inbox',
  'tux:whatsapp:load-conversation',
  'tux:whatsapp:send-text',
  'tux:whatsapp:send-media',
  'tux:whatsapp:send-location',
  'tux:whatsapp:retry-failed',
  'tux:whatsapp:get-media-access',
  'tux:whatsapp:mark-unread',
  'tux:whatsapp:archive',
  'tux:whatsapp:set-follow-up',
  'tux:whatsapp:link-order',
  'tux:whatsapp:save-draft',
  'tux:whatsapp:get-draft',
  'tux:whatsapp:resolve-customer-order-context',
  'tux:whatsapp:resolve-messaging-target',
  'tux:whatsapp:send-template',
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
    sendMedia: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'not used' },
    })) as never,
    sendLocation: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'not used' },
    })) as never,
    retryFailedMessage: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'not used' },
    })) as never,
    getMediaAccess: vi.fn(async () => ({
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
    resolveMessagingTarget: vi.fn(async () => ({
      ok: true,
      value: {
        mode: 'FREE_FORM',
        conversationId,
        freeFormUntil: '2026-09-05T10:00:00.000Z',
        config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
      },
    })) as never,
    sendTemplate: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'not used' },
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
  it('registers exactly all sixteen WhatsApp channels', () => {
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
      [
        channels[3],
        'sendMedia',
        [
          {
            conversationId,
            outboundIntentKey: 'media-intent',
            media: {
              kind: 'IMAGE',
              bytes: new Uint8Array([0xff, 0xd8, 0xff]),
              mimeType: 'image/jpeg',
              fileName: 'photo.jpg',
            },
          },
        ],
      ],
      [
        channels[4],
        'sendLocation',
        [
          {
            conversationId,
            outboundIntentKey: 'location-intent',
            location: { latitude: 30.0444, longitude: 31.2357, name: 'TUX', address: 'Cairo' },
          },
        ],
      ],
      [channels[5], 'retryFailedMessage', [{ messageId, outboundIntentKey: 'retry-intent' }]],
      [channels[6], 'getMediaAccess', [messageId]],
      [channels[7], 'markUnread', [conversationId]],
      [channels[8], 'archive', [conversationId, true]],
      [channels[9], 'setFollowUp', [conversationId, true]],
      [channels[10], 'linkOrder', [{ conversationId, orderId, linked: true }]],
      [channels[11], 'saveDraft', [conversationId, '']],
      [channels[12], 'getDraft', [conversationId]],
      [channels[13], 'resolveCustomerOrderContext', [conversationId]],
      [
        channels[14],
        'resolveMessagingTarget',
        [{ normalizedPhone: '+201012345678', displayPhone: '010 1234 5678' }],
      ],
      [
        channels[15],
        'sendTemplate',
        [
          {
            normalizedPhone: '+201012345678',
            displayPhone: '010 1234 5678',
            templateId: 'starter-1',
            outboundIntentKey: 'intent-1',
          },
        ],
      ],
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
    await expect(handler(channels[8])({}, conversationId, 'yes')).rejects.toThrow();
    await expect(handler(channels[9])({}, conversationId, 1)).rejects.toThrow();
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
    await expect(handler(channels[10])({}, value)).rejects.toThrow();
    expect(api.linkOrder).not.toHaveBeenCalled();
  });

  it('permits an empty draft string but rejects malformed draft arguments', async () => {
    const api = service();
    register(api);
    await handler(channels[11])({}, conversationId, '');
    expect(api.saveDraft).toHaveBeenCalledWith(conversationId, '');
    await expect(handler(channels[11])({}, 'bad', '')).rejects.toThrow();
    await expect(handler(channels[11])({}, conversationId, 1)).rejects.toThrow();
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('validates getDraft conversationId before invoking the service', async () => {
    const api = service();
    register(api);
    await expect(handler(channels[12])({}, 'bad')).rejects.toThrow();
    expect(api.getDraft).not.toHaveBeenCalled();
  });

  it('validates customer-order context conversationId before invoking the service', async () => {
    const api = service() as TuxWhatsAppApi & {
      resolveCustomerOrderContext: ReturnType<typeof vi.fn>;
    };
    register(api as TuxWhatsAppApi);
    await expect(handler(channels[13])({}, 'bad')).rejects.toThrow();
    expect(api.resolveCustomerOrderContext).not.toHaveBeenCalled();
  });

  it('accepts only customer phone identity when resolving a messaging target', async () => {
    const api = service();
    register(api);
    const event = { sender: { id: 77 } };

    await expect(
      handler(channels[14])(event, {
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(api.resolveMessagingTarget).toHaveBeenCalledExactlyOnceWith({
      normalizedPhone: '+201012345678',
      displayPhone: '010 1234 5678',
    });

    await expect(
      handler(channels[14])(event, {
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
        shopId: 'forged-shop',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('accepts only public template intent fields and rejects renderer-supplied trusted authority', async () => {
    const api = service();
    register(api);
    const event = { sender: { id: 77 } };

    await handler(channels[15])(event, {
      normalizedPhone: '+201012345678',
      displayPhone: '010 1234 5678',
      templateId: 'starter-1',
      outboundIntentKey: 'intent-1',
    });
    expect(api.sendTemplate).toHaveBeenCalledExactlyOnceWith({
      normalizedPhone: '+201012345678',
      displayPhone: '010 1234 5678',
      templateId: 'starter-1',
      outboundIntentKey: 'intent-1',
    });

    await expect(
      handler(channels[15])(event, {
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
        templateId: 'starter-1',
        outboundIntentKey: 'intent-2',
        workerId: 'forged-worker',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('removes every WhatsApp handler on close', () => {
    const { runtime } = register();
    runtime.close();
    expect([...electron.handlers.keys()]).toEqual([]);
    for (const channel of channels) expect(electron.removeHandler).toHaveBeenCalledWith(channel);
  });
});
