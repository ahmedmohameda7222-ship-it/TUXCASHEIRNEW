import { createHash } from 'node:crypto';
import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type DeviceId,
  type ShopId,
  type WhatsAppMessage,
  type WorkerId,
} from '@tux/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest, GatewayResponse } from './supabaseGateway';
import {
  handleWhatsAppOperations,
  type WhatsAppOperationsDependencyFactory,
} from './whatsappOperationsGateway';
import { WhatsAppProviderError } from './whatsappProviderGateway';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const deviceId = parseEntityId<DeviceId>('40000000-0000-4000-8000-000000000001');
const conversationId = '50000000-0000-4000-8000-000000000001';
const messageId = '60000000-0000-4000-8000-000000000001';
const failedMessageId = '60000000-0000-4000-8000-000000000002';

function jwtWithFutureExpiry(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}

function validCookie(): string {
  return [
    `tux_ops_access=${jwtWithFutureExpiry()}`,
    'tux_ops_refresh=test-refresh-token',
    `tux_ops_shop=${shopId}`,
    `tux_ops_device=${deviceId}`,
  ].join('; ');
}

function request(body: Readonly<Record<string, unknown>>): GatewayRequest {
  return {
    method: 'POST',
    url: '/api/whatsapp',
    headers: {
      host: 'ops.example',
      origin: 'https://ops.example',
      cookie: validCookie(),
    },
    body,
  } as unknown as GatewayRequest;
}

function responseHarness() {
  let statusCode = 200;
  let body = '';
  const response = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(value: number) {
      statusCode = value;
    },
    setHeader: vi.fn(),
    end: vi.fn((value?: string) => {
      body = value ?? '';
    }),
  } as unknown as GatewayResponse;
  return {
    response,
    status: () => statusCode,
    json: () => JSON.parse(body || '{}') as Record<string, unknown>,
  };
}

function outboundMessage(status: 'PENDING' | 'SENT' | 'FAILED' = 'PENDING'): WhatsAppMessage {
  return {
    id: messageId,
    shopId,
    conversationId,
    providerMessageId: status === 'SENT' ? 'wamid.sent' : null,
    outboundIntentKey: 'media-intent',
    direction: 'OUTBOUND',
    kind: 'IMAGE',
    text: null,
    mediaRef: 'media-key',
    media: {
      mediaKey: 'media-key',
      kind: 'IMAGE',
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
      byteSize: 3,
      storedAt: instant('2026-09-04T10:00:00.000Z'),
      expiresAt: instant('2026-10-04T10:00:00.000Z'),
      availability: 'AVAILABLE',
    },
    location: null,
    status,
    sentByWorkerId: workerId,
    initiatedByDeviceId: deviceId,
    initiatedAt: instant('2026-09-04T10:00:00.000Z'),
    createdAt: instant('2026-09-04T10:00:00.000Z'),
  };
}

function createDependencies() {
  const repository = {
    resolveCurrentOperator: vi.fn(async () => ({ businessDayId, workerId })),
    resolveMessagingPolicy: vi.fn(async () => ({
      conversationId,
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      lastInboundAt: '2026-09-04T09:00:00.000Z',
      freeFormUntil: '2026-09-05T09:00:00.000Z',
      templates: [],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    })),
    claimOutboundMediaIntent: vi.fn(async () => ({
      created: true,
      recipientNormalizedPhone: '01012345678',
      message: outboundMessage(),
    })),
    claimOutboundLocationIntent: vi.fn(async () => ({
      created: true,
      recipientNormalizedPhone: '01012345678',
      message: {
        ...outboundMessage(),
        kind: 'LOCATION',
        mediaRef: null,
        media: null,
        location: {
          latitude: 30.0444,
          longitude: 31.2357,
          name: 'TUX Store',
          address: 'Cairo',
        },
      },
    })),
    resolveRetryableMessage: vi.fn(async () => outboundMessage('FAILED')),
    claimRetryIntent: vi.fn(async () => ({
      created: true,
      recipientNormalizedPhone: '01012345678',
      message: outboundMessage(),
    })),
    resolveMediaAccess: vi.fn(async () => ({
      messageId,
      objectPath: 'media/10000000-0000-4000-8000-000000000001/media-key',
      expiresAt: '2026-10-04T10:00:00.000Z',
      deletedAt: null,
    })),
    attachProviderMessage: vi.fn(async () => undefined),
    failOutboundIntent: vi.fn(async () => undefined),
  };
  const providerGateway = {
    sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.sent' })),
    fetchMedia: vi.fn(),
  };
  const mediaStorage = {
    createSignedUpload: vi.fn(async () => ({
      objectPath: 'quarantine/upload',
      url: 'https://example.supabase.co/storage/v1/upload/signed',
    })),
    createSignedDownload: vi.fn(async () => ({
      status: 'AVAILABLE' as const,
      url: 'https://example.supabase.co/storage/v1/object/sign/media',
      urlExpiresAt: '2026-09-04T10:05:00.000Z',
    })),
    inspectUploadedMedia: vi.fn(async () => ({
      objectPath: 'media/10000000-0000-4000-8000-000000000001/media-key',
      prefix: new Uint8Array([0xff, 0xd8, 0xff]),
      byteSize: 3,
      sha256: 'sha256',
      storedAt: '2026-09-04T10:00:00.000Z',
      expiresAt: '2026-10-04T10:00:00.000Z',
    })),
  };
  const channelResolver = {
    resolveInboundChannel: vi.fn(async () => null),
    resolveOutboundChannel: vi.fn(async () => ({
      channelId: '70000000-0000-4000-8000-000000000001',
      provider: 'META_CLOUD_API' as const,
      providerPhoneNumberId: 'provider-phone-1',
    })),
  };
  const factory = {
    createRepository: vi.fn(() => repository),
    createChannelResolver: vi.fn(() => channelResolver),
    createProviderGateway: vi.fn(() => providerGateway),
    createMediaStorage: vi.fn(() => mediaStorage),
    resolveDeviceAuthority: vi.fn(async () => ({ shopId, deviceId })),
    now: vi.fn(() => new Date('2026-09-04T10:00:00.000Z')),
  } as unknown as WhatsAppOperationsDependencyFactory;
  return { factory, repository, providerGateway, mediaStorage };
}

async function execute(
  body: Readonly<Record<string, unknown>>,
  factory: WhatsAppOperationsDependencyFactory,
) {
  const harness = responseHarness();
  await handleWhatsAppOperations(request(body), harness.response, factory);
  return harness;
}

function createUploadBody(overrides: Record<string, unknown> = {}) {
  return {
    action: 'CREATE_MEDIA_UPLOAD',
    businessDayId,
    workerId,
    conversationId,
    outboundIntentKey: 'media-intent',
    kind: 'IMAGE',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    byteSize: 3,
    ...overrides,
  };
}

function finalizeBody() {
  return {
    action: 'FINALIZE_MEDIA_SEND',
    businessDayId,
    workerId,
    conversationId,
    outboundIntentKey: 'media-intent',
    mediaKey: createHash('sha256')
      .update(`outbound:${shopId}:media-intent`)
      .digest('hex'),
    kind: 'IMAGE',
    mimeType: 'image/jpeg',
    fileName: 'photo.jpg',
    byteSize: 3,
  };
}

beforeEach(() => {
  vi.stubEnv('TUX_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('TUX_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Task 9C WhatsApp server actions', () => {
  it('creates a short-lived server-authorized upload for valid media metadata', async () => {
    const deps = createDependencies();
    const result = await execute(createUploadBody(), deps.factory);
    const expectedMediaKey = createHash('sha256')
      .update(`outbound:${shopId}:media-intent`)
      .digest('hex');

    expect(result.status()).toBe(200);
    expect(result.json()).toMatchObject({
      upload: {
        mediaKey: expectedMediaKey,
        uploadUrl: 'https://example.supabase.co/storage/v1/upload/signed',
      },
    });
    expect(deps.mediaStorage.createSignedUpload).toHaveBeenCalledWith({
      shopId,
      mediaKey: expectedMediaKey,
      fileName: 'photo.jpg',
    });
  });

  it.each([
    { mimeType: 'application/x-msdownload' },
    { byteSize: 5 * 1024 * 1024 + 1 },
  ])('rejects invalid media declaration before signing: %j', async (override) => {
    const deps = createDependencies();
    const result = await execute(createUploadBody(override), deps.factory);

    expect(result.status()).toBe(400);
    expect(deps.mediaStorage.createSignedUpload).not.toHaveBeenCalled();
  });

  it('rejects media finalize when the free-form window is closed', async () => {
    const deps = createDependencies();
    deps.repository.resolveMessagingPolicy.mockResolvedValueOnce({
      conversationId,
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      lastInboundAt: '2026-09-01T09:00:00.000Z',
      freeFormUntil: '2026-09-02T09:00:00.000Z',
      templates: [],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    });

    const result = await execute(finalizeBody(), deps.factory);

    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_free_form_window_closed' });
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('marks a definitive provider rejection FAILED during media finalize', async () => {
    const deps = createDependencies();
    deps.providerGateway.sendMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(400, 131030, 'WhatsApp provider rejected the request.'),
    );

    const result = await execute(finalizeBody(), deps.factory);

    expect(result.status()).toBe(502);
    expect(result.json()).toMatchObject({
      error: 'whatsapp_provider_rejected',
      messageId,
    });
    expect(deps.repository.failOutboundIntent).toHaveBeenCalledWith(
      expect.objectContaining({ shopId, messageId }),
    );
  });

  it('keeps provider transport uncertainty pending during media finalize', async () => {
    const deps = createDependencies();
    deps.providerGateway.sendMessage.mockRejectedValueOnce(
      new WhatsAppProviderError(null, null, 'WhatsApp provider is unavailable.'),
    );

    const result = await execute(finalizeBody(), deps.factory);

    expect(result.status()).toBe(503);
    expect(result.json()).toMatchObject({
      error: 'whatsapp_delivery_uncertain',
      messageId,
    });
    expect(deps.repository.failOutboundIntent).not.toHaveBeenCalled();
  });

  it('does not duplicate provider send when finalize replays an existing durable attempt', async () => {
    const deps = createDependencies();
    deps.repository.claimOutboundMediaIntent.mockResolvedValueOnce({
      created: false,
      recipientNormalizedPhone: '01012345678',
      message: outboundMessage('SENT'),
    });

    const result = await execute(finalizeBody(), deps.factory);

    expect(result.status()).toBe(200);
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('rejects location send when the free-form window is closed', async () => {
    const deps = createDependencies();
    deps.repository.resolveMessagingPolicy.mockResolvedValueOnce({
      conversationId,
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      lastInboundAt: null,
      freeFormUntil: null,
      templates: [],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    });

    const result = await execute(
      {
        action: 'SEND_LOCATION',
        businessDayId,
        workerId,
        conversationId,
        outboundIntentKey: 'location-intent',
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Store',
        address: 'Cairo',
      },
      deps.factory,
    );

    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_free_form_window_closed' });
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('refuses explicit retry while the original message is still pending', async () => {
    const deps = createDependencies();
    deps.repository.resolveRetryableMessage.mockResolvedValueOnce(outboundMessage('PENDING'));

    const result = await execute(
      {
        action: 'RETRY_FAILED',
        businessDayId,
        workerId,
        messageId: failedMessageId,
        outboundIntentKey: 'retry-intent',
      },
      deps.factory,
    );

    expect(result.status()).toBe(409);
    expect(result.json()).toMatchObject({ error: 'whatsapp_outbound_intent_conflict' });
    expect(deps.providerGateway.sendMessage).not.toHaveBeenCalled();
  });

  it('returns explicit EXPIRED media access without a signed URL', async () => {
    const deps = createDependencies();
    deps.repository.resolveMediaAccess.mockResolvedValueOnce({
      messageId,
      objectPath: 'media/path',
      expiresAt: '2026-09-03T10:00:00.000Z',
      deletedAt: null,
    });

    const result = await execute(
      { action: 'GET_MEDIA_ACCESS', messageId },
      deps.factory,
    );

    expect(result.status()).toBe(200);
    expect(result.json()).toMatchObject({
      mediaAccess: { availability: 'EXPIRED', url: null, expiresAt: null },
    });
    expect(deps.mediaStorage.createSignedDownload).not.toHaveBeenCalled();
  });

  it('does not reveal a media record that is outside the resolved shop', async () => {
    const deps = createDependencies();
    deps.repository.resolveMediaAccess.mockResolvedValueOnce(null);

    const result = await execute(
      { action: 'GET_MEDIA_ACCESS', messageId },
      deps.factory,
    );

    expect(result.status()).toBe(404);
    expect(result.json()).toMatchObject({ error: 'whatsapp_media_not_found' });
  });
});
