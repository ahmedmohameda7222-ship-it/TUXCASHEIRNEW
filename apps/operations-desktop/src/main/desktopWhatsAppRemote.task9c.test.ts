import { parseEntityId, type BusinessDayId, type WorkerId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { DesktopWhatsAppRemote } from './desktopWhatsAppRemote';

const shopId = '11111111-1111-4111-8111-111111111111';
const deviceId = '22222222-2222-4222-8222-222222222222';
const businessDayId = parseEntityId<BusinessDayId>('33333333-3333-4333-8333-333333333333');
const workerId = parseEntityId<WorkerId>('44444444-4444-4444-8444-444444444444');
const conversationId = '55555555-5555-4555-8555-555555555555';
const messageId = '66666666-6666-4666-8666-666666666666';
const mediaKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function validResolution() {
  return {
    status: 'VALID' as const,
    session: {
      shopId,
      deviceId,
      accessToken: 'short-lived-access',
      refreshToken: 'must-never-be-transmitted',
      expiresAt: 2_000_000_000,
    },
  };
}

function sessionManager() {
  return { resolveSession: vi.fn().mockResolvedValue(validResolution()) };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mediaMessage() {
  return {
    id: messageId,
    shopId,
    conversationId,
    providerMessageId: 'wamid.media',
    outboundIntentKey: 'media-intent',
    direction: 'OUTBOUND',
    kind: 'IMAGE',
    text: null,
    mediaRef: mediaKey,
    media: {
      mediaKey,
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
    sentByWorkerId: workerId,
    initiatedByDeviceId: deviceId,
    initiatedAt: '2026-09-05T10:00:00.000Z',
    createdAt: '2026-09-05T10:00:00.000Z',
  };
}

function bodyAt(fetcher: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
  const init = fetcher.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('DesktopWhatsAppRemote Task 9C transport', () => {
  it('uses bearer/device auth for create/finalize but strips it completely from signed upload', async () => {
    const uploadUrl = 'https://storage.example/upload/signed-object';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(200, { upload: { mediaKey, uploadUrl } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json(200, { message: mediaMessage() }));
    const manager = sessionManager();
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });

    await expect(
      remote.sendMedia({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'media-intent',
        media: {
          kind: 'IMAGE',
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
        },
      }),
    ).resolves.toEqual(mediaMessage());

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(manager.resolveSession).toHaveBeenCalledTimes(2);
    for (const index of [0, 2]) {
      const [target, init] = fetcher.mock.calls[index] as [URL, RequestInit];
      expect(String(target)).toBe('https://ops.example/api/whatsapp');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer short-lived-access',
        'x-tux-device-id': deviceId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      });
    }

    const [signedTarget, signedInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(String(signedTarget)).toBe(uploadUrl);
    expect(signedInit.method).toBe('PUT');
    expect(signedInit.body).toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(signedInit.headers ?? {})).not.toMatch(
      /authorization|x-tux-device-id|apikey|bearer|meta/i,
    );

    expect(bodyAt(fetcher, 0)).toEqual({
      action: 'CREATE_MEDIA_UPLOAD',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'media-intent',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      byteSize: 3,
    });
    expect(bodyAt(fetcher, 2)).toEqual({
      action: 'FINALIZE_MEDIA_SEND',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'media-intent',
      mediaKey,
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      byteSize: 3,
    });
  });

  it('never cookie-downgrades when device session resolution is unavailable for media create', async () => {
    const manager = {
      resolveSession: vi.fn().mockResolvedValue({ status: 'TRANSPORT_UNAVAILABLE', message: 'offline' }),
    };
    const fetcher = vi.fn();
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: manager as never,
      fetcher,
    });

    await expect(
      remote.sendMedia({
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'media-intent',
        media: {
          kind: 'IMAGE',
          bytes: new Uint8Array([0xff, 0xd8, 0xff]),
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
        },
      }),
    ).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends location/retry and reads media access through authenticated TUX API requests', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(200, { message: mediaMessage() }))
      .mockResolvedValueOnce(json(200, { message: mediaMessage() }))
      .mockResolvedValueOnce(
        json(200, {
          mediaAccess: {
            availability: 'EXPIRED',
            url: null,
            expiresAt: null,
          },
        }),
      );
    const remote = new DesktopWhatsAppRemote({
      apiOrigin: 'https://ops.example',
      sessionManager: sessionManager() as never,
      fetcher,
    });

    await remote.sendLocation({
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'location-intent',
      location: { latitude: 30.0444, longitude: 31.2357, name: null, address: null },
    });
    await remote.retryFailedMessage({
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-intent',
    });
    await expect(remote.getMediaAccess(messageId)).resolves.toEqual({
      availability: 'EXPIRED',
      url: null,
      expiresAt: null,
    });

    expect(bodyAt(fetcher, 0)).toEqual({
      action: 'SEND_LOCATION',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'location-intent',
      latitude: 30.0444,
      longitude: 31.2357,
      name: null,
      address: null,
    });
    expect(bodyAt(fetcher, 1)).toEqual({
      action: 'RETRY_FAILED',
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-intent',
    });
    expect(bodyAt(fetcher, 2)).toEqual({ action: 'GET_MEDIA_ACCESS', messageId });
  });
});
