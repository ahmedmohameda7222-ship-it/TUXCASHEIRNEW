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

import { WhatsAppIpcRuntime } from './whatsappIpc';

const conversationId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

function service() {
  return {
    loadInbox: vi.fn(),
    loadConversation: vi.fn(),
    resolveCustomerOrderContext: vi.fn(),
    resolveMessagingTarget: vi.fn(),
    sendTemplate: vi.fn(),
    sendText: vi.fn(),
    sendMedia: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'x' },
    })),
    sendLocation: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'x' },
    })),
    retryFailedMessage: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'x' },
    })),
    getMediaAccess: vi.fn(async () => ({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'x' },
    })),
    markUnread: vi.fn(),
    archive: vi.fn(),
    setFollowUp: vi.fn(),
    linkOrder: vi.fn(),
    saveDraft: vi.fn(),
    getDraft: vi.fn(),
  };
}

function register() {
  const api = service();
  new WhatsAppIpcRuntime({ service: api as never }).register({
    webContents: { id: 77 },
  } as never);
  return api;
}

function handler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const value = electron.handlers.get(channel);
  if (value === undefined) throw new Error(`missing handler ${channel}`);
  return value as (...args: unknown[]) => Promise<unknown>;
}

beforeEach(() => {
  electron.handlers.clear();
  vi.clearAllMocks();
});

describe('WhatsAppIpcRuntime Task 9C boundary', () => {
  it('registers trusted handlers for media, location, explicit retry, and media access', async () => {
    const api = register();
    const event = { sender: { id: 77 } };

    await handler('tux:whatsapp:send-media')(event, {
      conversationId,
      outboundIntentKey: 'media-intent',
      media: {
        kind: 'IMAGE',
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
      },
    });
    await handler('tux:whatsapp:send-location')(event, {
      conversationId,
      outboundIntentKey: 'location-intent',
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX',
        address: 'Cairo',
      },
    });
    await handler('tux:whatsapp:retry-failed')(event, {
      messageId,
      outboundIntentKey: 'retry-intent',
    });
    await handler('tux:whatsapp:get-media-access')(event, messageId);

    expect(api.sendMedia).toHaveBeenCalledTimes(1);
    expect(api.sendLocation).toHaveBeenCalledTimes(1);
    expect(api.retryFailedMessage).toHaveBeenCalledTimes(1);
    expect(api.getMediaAccess).toHaveBeenCalledWith(messageId);
    expect(security.assertTrustedIpcSender).toHaveBeenCalledTimes(4);
  });

  it('rejects renderer file paths and malformed media before service invocation', async () => {
    const api = register();
    const send = handler('tux:whatsapp:send-media');

    await expect(
      send(
        {},
        {
          conversationId,
          outboundIntentKey: 'media-intent',
          media: {
            kind: 'IMAGE',
            bytes: new Uint8Array([0xff, 0xd8, 0xff]),
            mimeType: 'image/jpeg',
            fileName: 'photo.jpg',
            filePath: 'C:\\Users\\worker\\secret.jpg',
          },
        },
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      send(
        {},
        {
          conversationId,
          outboundIntentKey: 'media-intent',
          media: {
            kind: 'IMAGE',
            bytes: [1, 2, 3],
            mimeType: 'image/jpeg',
            fileName: null,
          },
        },
      ),
    ).rejects.toThrow(TypeError);
    expect(api.sendMedia).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinates and malformed message ids before service invocation', async () => {
    const api = register();
    await expect(
      handler('tux:whatsapp:send-location')({}, {
        conversationId,
        outboundIntentKey: 'location-intent',
        location: { latitude: 91, longitude: 31.2, name: null, address: null },
      }),
    ).rejects.toThrow(TypeError);
    await expect(
      handler('tux:whatsapp:retry-failed')({}, {
        messageId: 'not-a-uuid',
        outboundIntentKey: 'retry-intent',
      }),
    ).rejects.toThrow(TypeError);
    await expect(handler('tux:whatsapp:get-media-access')({}, 'not-a-uuid')).rejects.toThrow(
      TypeError,
    );
    expect(api.sendLocation).not.toHaveBeenCalled();
    expect(api.retryFailedMessage).not.toHaveBeenCalled();
    expect(api.getMediaAccess).not.toHaveBeenCalled();
  });
});
