import { parseEntityId, type BusinessDayId, type WorkerId } from '@tux/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';

const businessDayId = parseEntityId<BusinessDayId>('10000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const conversationId = '40000000-0000-4000-8000-000000000001';
const messageId = '50000000-0000-4000-8000-000000000001';
const shopId = '60000000-0000-4000-8000-000000000001';
const deviceId = '70000000-0000-4000-8000-000000000001';
const mediaKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

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

function locationMessage() {
  return {
    ...mediaMessage(),
    providerMessageId: 'wamid.location',
    outboundIntentKey: 'location-intent',
    kind: 'LOCATION',
    mediaRef: null,
    media: null,
    location: {
      latitude: 30.0444,
      longitude: 31.2357,
      name: 'TUX Store',
      address: 'Cairo',
    },
  };
}

function bodyAt(fetchMock: ReturnType<typeof vi.fn>, index: number): Record<string, unknown> {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => vi.unstubAllGlobals());

describe('VercelBrowserWhatsAppRemote Task 9C transport', () => {
  it('uses same-origin create/finalize calls and uploads bytes only to the signed URL', async () => {
    const uploadUrl = 'https://storage.example/upload/signed-object';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { upload: { mediaKey, uploadUrl } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json(200, { message: mediaMessage() }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new VercelBrowserWhatsAppRemote().sendMedia({
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

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/whatsapp');
    expect(bodyAt(fetchMock, 0)).toEqual({
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

    const [signedTarget, signedInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(signedTarget).toBe(uploadUrl);
    expect(signedInit.method).toBe('PUT');
    expect(signedInit.body).toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(signedInit.headers ?? {})).not.toMatch(
      /authorization|x-tux-device-id|apikey|meta|bearer/i,
    );

    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/whatsapp');
    expect(bodyAt(fetchMock, 2)).toEqual({
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

  it('never uploads selected bytes when CREATE_MEDIA_UPLOAD is rejected', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json(409, { error: 'whatsapp_free_form_window_closed' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new VercelBrowserWhatsAppRemote().sendMedia({
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
    ).rejects.toMatchObject({ code: 'FREE_FORM_WINDOW_CLOSED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serializes structured location and explicit failed retry without trusted authority fields', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { message: locationMessage() }))
      .mockResolvedValueOnce(json(200, { message: mediaMessage() }));
    vi.stubGlobal('fetch', fetchMock);
    const remote = new VercelBrowserWhatsAppRemote();

    await remote.sendLocation({
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'location-intent',
      location: { latitude: 30.0444, longitude: 31.2357, name: 'TUX Store', address: 'Cairo' },
    });
    await remote.retryFailedMessage({
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-intent',
    });

    expect(bodyAt(fetchMock, 0)).toEqual({
      action: 'SEND_LOCATION',
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'location-intent',
      latitude: 30.0444,
      longitude: 31.2357,
      name: 'TUX Store',
      address: 'Cairo',
    });
    expect(bodyAt(fetchMock, 1)).toEqual({
      action: 'RETRY_FAILED',
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-intent',
    });
    expect(JSON.stringify([bodyAt(fetchMock, 0), bodyAt(fetchMock, 1)])).not.toMatch(
      /shopId|deviceId|sentByWorkerId|providerPhoneNumberId|\bto\b/i,
    );
  });

  it('parses short-lived media access and never persists or echoes the signed URL', async () => {
    const signedUrl = 'https://storage.example/object/sign/media?token=short';
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        mediaAccess: {
          availability: 'AVAILABLE',
          url: signedUrl,
          expiresAt: '2026-09-05T10:05:00.000Z',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(new VercelBrowserWhatsAppRemote().getMediaAccess(messageId)).resolves.toEqual({
      availability: 'AVAILABLE',
      url: signedUrl,
      expiresAt: '2026-09-05T10:05:00.000Z',
    });
    expect(bodyAt(fetchMock, 0)).toEqual({ action: 'GET_MEDIA_ACCESS', messageId });
  });
});
