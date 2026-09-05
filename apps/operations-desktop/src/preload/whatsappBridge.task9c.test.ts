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

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  harness.exposed = null;
  await import('./index');
});

afterEach(() => vi.unstubAllGlobals());

function whatsapp(): Record<string, (...args: never[]) => Promise<unknown>> {
  return (harness.exposed as { whatsapp: Record<string, (...args: never[]) => Promise<unknown>> })
    .whatsapp;
}

const conversationId = '11111111-1111-4111-8111-111111111111';
const messageId = '22222222-2222-4222-8222-222222222222';

function message() {
  return {
    id: messageId,
    shopId: '33333333-3333-4333-8333-333333333333',
    conversationId,
    providerMessageId: 'wamid.media',
    outboundIntentKey: 'media-intent',
    direction: 'OUTBOUND',
    kind: 'IMAGE',
    text: null,
    mediaRef: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    media: {
      mediaKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      byteSize: 3,
      storedAt: '2026-09-05T10:00:00.000Z',
      expiresAt: '2026-10-05T10:00:00.000Z',
      availability: 'AVAILABLE',
    },
    location: null,
    status: 'SENT',
    sentByWorkerId: '44444444-4444-4444-8444-444444444444',
    initiatedByDeviceId: '55555555-5555-4555-8555-555555555555',
    initiatedAt: '2026-09-05T10:00:00.000Z',
    createdAt: '2026-09-05T10:00:00.000Z',
  };
}

describe('desktop WhatsApp Task 9C preload bridge', () => {
  it('exposes media/location/retry methods and sends only approved structured inputs to IPC', async () => {
    harness.invoke.mockResolvedValue({ ok: true, value: message() });

    await whatsapp().sendMedia({
      conversationId,
      outboundIntentKey: 'media-intent',
      media: {
        kind: 'IMAGE',
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
      },
    } as never);
    expect(harness.invoke).toHaveBeenLastCalledWith('tux:whatsapp:send-media', {
      conversationId,
      outboundIntentKey: 'media-intent',
      media: {
        kind: 'IMAGE',
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
      },
    });

    await whatsapp().sendLocation({
      conversationId,
      outboundIntentKey: 'location-intent',
      location: { latitude: 30.0444, longitude: 31.2357, name: null, address: null },
    } as never);
    expect(harness.invoke).toHaveBeenLastCalledWith(
      'tux:whatsapp:send-location',
      expect.objectContaining({ conversationId, outboundIntentKey: 'location-intent' }),
    );

    await whatsapp().retryFailedMessage({ messageId, outboundIntentKey: 'retry-intent' } as never);
    expect(harness.invoke).toHaveBeenLastCalledWith('tux:whatsapp:retry-failed', {
      messageId,
      outboundIntentKey: 'retry-intent',
    });
  });

  it('rejects unsafe media inputs in preload before Electron IPC', async () => {
    await expect(
      whatsapp().sendMedia({
        conversationId,
        outboundIntentKey: 'media-intent',
        media: {
          kind: 'IMAGE',
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          filePath: 'C:\\Users\\worker\\secret.jpg',
        },
      } as never),
    ).rejects.toThrow(TypeError);
    await expect(
      whatsapp().sendMedia({
        conversationId,
        outboundIntentKey: 'media-intent',
        media: {
          kind: 'IMAGE',
          bytes: new Uint8Array(5 * 1024 * 1024 + 1),
          mimeType: 'image/jpeg',
          fileName: 'too-large.jpg',
        },
      } as never),
    ).rejects.toThrow(TypeError);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it('validates coordinates and short-lived media access response shapes defensively', async () => {
    await expect(
      whatsapp().sendLocation({
        conversationId,
        outboundIntentKey: 'location-intent',
        location: { latitude: 95, longitude: 31.2, name: null, address: null },
      } as never),
    ).rejects.toThrow(TypeError);
    expect(harness.invoke).not.toHaveBeenCalled();

    harness.invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        availability: 'AVAILABLE',
        url: 'https://storage.example/object/sign/media?token=short',
        expiresAt: '2026-09-05T10:05:00.000Z',
      },
    });
    await expect(whatsapp().getMediaAccess(messageId as never)).resolves.toMatchObject({
      ok: true,
      value: { availability: 'AVAILABLE' },
    });
    expect(harness.invoke).toHaveBeenLastCalledWith('tux:whatsapp:get-media-access', messageId);

    harness.invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        availability: 'AVAILABLE',
        url: 'https://storage.example/object/sign/media?token=short',
        expiresAt: '2026-09-05T10:05:00.000Z',
        objectPath: 'media/private/secret',
      },
    });
    await expect(whatsapp().getMediaAccess(messageId as never)).rejects.toThrow(TypeError);
  });
});
