import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
  type WhatsAppMessage,
  type WorkerId,
} from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import type { OperationsSessionResult } from './session';
import { WhatsAppRemoteError, type WhatsAppRemoteGateway } from './whatsappRemote';
import { OperationsWhatsAppMessagingService } from './whatsappMessaging';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const workerId2 = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000002');
const conversationId = '40000000-0000-4000-8000-000000000001';
const messageId = '50000000-0000-4000-8000-000000000001';

interface Task9CRemote extends WhatsAppRemoteGateway {
  sendMedia(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: {
      readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly fileName: string | null;
    };
  }): Promise<WhatsAppMessage>;
  sendLocation(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: {
      readonly latitude: number;
      readonly longitude: number;
      readonly name: string | null;
      readonly address: string | null;
    };
  }): Promise<WhatsAppMessage>;
  retryFailedMessage(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly messageId: string;
    readonly outboundIntentKey: string;
  }): Promise<WhatsAppMessage>;
  getMediaAccess(messageId: string): Promise<{
    readonly availability: 'AVAILABLE' | 'EXPIRED';
    readonly url: string | null;
    readonly expiresAt: string | null;
  }>;
}

interface Task9CMessagingService extends OperationsWhatsAppMessagingService {
  sendMedia(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: {
      readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly fileName: string | null;
    };
  }): ReturnType<Task9CRemote['sendMedia']> | Promise<unknown>;
  sendLocation(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: {
      readonly latitude: number;
      readonly longitude: number;
      readonly name: string | null;
      readonly address: string | null;
    };
  }): Promise<unknown>;
  retryFailedMessage(input: {
    readonly messageId: string;
    readonly outboundIntentKey: string;
  }): Promise<unknown>;
  getMediaAccess(messageId: string): Promise<unknown>;
}

function active(worker = workerId): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId,
      businessDayId,
      businessDayStartedAt: instant('2026-09-04T08:00:00.000Z'),
      operator: { id: worker, displayName: 'Worker' },
    },
  };
}

function outboundMessage(
  kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' = 'TEXT',
  status: 'PENDING' | 'SENT' | 'FAILED' = 'SENT',
): WhatsAppMessage {
  const isBinary = kind === 'IMAGE' || kind === 'DOCUMENT' || kind === 'AUDIO';
  const isLocation = kind === 'LOCATION';
  return {
    id: messageId,
    shopId,
    conversationId,
    providerMessageId: status === 'SENT' ? 'wamid.outbound' : null,
    outboundIntentKey: 'intent-outbound',
    direction: 'OUTBOUND',
    kind,
    text: kind === 'TEXT' ? 'أهلاً بحضرتك' : null,
    mediaRef: isBinary ? 'media-key-1' : null,
    media: isBinary
      ? {
          mediaKey: 'media-key-1',
          kind,
          mimeType: kind === 'IMAGE' ? 'image/jpeg' : 'application/pdf',
          fileName: kind === 'AUDIO' ? null : 'file.bin',
          byteSize: 4,
          storedAt: instant('2026-09-04T10:00:00.000Z'),
          expiresAt: instant('2026-10-04T10:00:00.000Z'),
          availability: 'AVAILABLE',
        }
      : null,
    location: isLocation
      ? { latitude: 30.0444, longitude: 31.2357, name: 'TUX Store', address: 'Cairo' }
      : null,
    status,
    sentByWorkerId: workerId,
    initiatedByDeviceId: parseEntityId('60000000-0000-4000-8000-000000000001'),
    initiatedAt: instant('2026-09-04T10:00:00.000Z'),
    createdAt: instant('2026-09-04T10:00:00.000Z'),
  };
}

function remote(): Task9CRemote {
  return {
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    resolveMessagingTarget: vi.fn().mockResolvedValue({
      mode: 'FREE_FORM',
      conversationId,
      freeFormUntil: instant('2026-09-05T08:00:00.000Z'),
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    }),
    sendText: vi.fn(),
    sendTemplate: vi.fn().mockResolvedValue(outboundMessage()),
    sendMedia: vi.fn().mockResolvedValue(outboundMessage('IMAGE')),
    sendLocation: vi.fn().mockResolvedValue(outboundMessage('LOCATION')),
    retryFailedMessage: vi.fn().mockResolvedValue(outboundMessage()),
    getMediaAccess: vi.fn().mockResolvedValue({
      availability: 'AVAILABLE',
      url: 'https://signed-upload-must-remain-transient.example/object',
      expiresAt: '2026-09-04T10:05:00.000Z',
    }),
    markUnread: vi.fn(),
    archive: vi.fn(),
    setFollowUp: vi.fn(),
    linkOrder: vi.fn(),
  };
}

function task9CService(
  gateway: Task9CRemote,
  getState: () => Promise<OperationsSessionResult>,
): Task9CMessagingService {
  return new OperationsWhatsAppMessagingService(
    gateway as WhatsAppRemoteGateway,
    { getState },
  ) as Task9CMessagingService;
}

describe('OperationsWhatsAppMessagingService', () => {
  it('resolves messaging target without accepting client tenant or worker authority', async () => {
    const gateway = remote();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => active(),
    });

    const result = await service.resolveMessagingTarget({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
    });

    expect(result).toMatchObject({ ok: true, value: { mode: 'FREE_FORM', conversationId } });
    expect(gateway.resolveMessagingTarget).toHaveBeenCalledWith({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
    });
  });

  it('resolves ACTIVE Current Operator claims at template-send call time', async () => {
    const gateway = remote();
    let state = active();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => state,
    });

    await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });
    state = active(workerId2);
    await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template-2',
    });

    expect(gateway.sendTemplate).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });
    expect(gateway.sendTemplate).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template-2',
    });
  });

  it('rejects template send when there is no ACTIVE Current Operator', async () => {
    const gateway = remote();
    const service = new OperationsWhatsAppMessagingService(gateway, {
      getState: async () => ({ ok: true, value: { status: 'NO_ACTIVE_DAY', shopId } }),
    });

    const result = await service.sendTemplate({
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templateId: '70000000-0000-4000-8000-000000000001',
      outboundIntentKey: 'intent-template',
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
    expect(gateway.sendTemplate).not.toHaveBeenCalled();
  });

  it('sends binary media only after sendMedia and resolves Current Operator claims at call time', async () => {
    const gateway = remote();
    let state = active();
    const service = task9CService(gateway, async () => state);
    const media = {
      kind: 'IMAGE' as const,
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
    };

    expect(gateway.sendMedia).not.toHaveBeenCalled();
    await service.sendMedia({ conversationId, outboundIntentKey: 'media-intent-1', media });
    state = active(workerId2);
    await service.sendMedia({ conversationId, outboundIntentKey: 'media-intent-2', media });

    expect(gateway.sendMedia).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'media-intent-1',
      media,
    });
    expect(gateway.sendMedia).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      conversationId,
      outboundIntentKey: 'media-intent-2',
      media,
    });
  });

  it('has no offline fallback when a media send fails remotely and does not expose signed URLs', async () => {
    const gateway = remote();
    gateway.sendMedia = vi.fn().mockRejectedValue(
      new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.'),
    );
    const service = task9CService(gateway, async () => active());

    const result = await service.sendMedia({
      conversationId,
      outboundIntentKey: 'media-intent-failed',
      media: {
        kind: 'DOCUMENT',
        bytes: new TextEncoder().encode('%PDF-1.7'),
        mimeType: 'application/pdf',
        fileName: 'invoice.pdf',
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'REMOTE_SYNC_ERROR' } });
    expect(gateway.sendMedia).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('signed-upload-must-remain-transient');
  });

  it('validates location coordinates before remote send', async () => {
    const gateway = remote();
    const service = task9CService(gateway, async () => active());

    const invalid = await service.sendLocation({
      conversationId,
      outboundIntentKey: 'location-invalid',
      location: { latitude: 91, longitude: 31.2357, name: null, address: null },
    });
    const valid = await service.sendLocation({
      conversationId,
      outboundIntentKey: 'location-valid',
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Store',
        address: 'Cairo',
      },
    });

    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(gateway.sendLocation).toHaveBeenCalledTimes(1);
    expect(gateway.sendLocation).toHaveBeenCalledWith({
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'location-valid',
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Store',
        address: 'Cairo',
      },
    });
    expect(valid).toMatchObject({ ok: true, value: { kind: 'LOCATION' } });
  });

  it('retries a failed message with fresh Current Operator claims and maps PENDING refusal to conflict', async () => {
    const gateway = remote();
    const service = task9CService(gateway, async () => active());

    const retry = await service.retryFailedMessage({
      messageId,
      outboundIntentKey: 'retry-intent-1',
    });
    expect(retry).toMatchObject({ ok: true });
    expect(gateway.retryFailedMessage).toHaveBeenCalledWith({
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-intent-1',
    });

    gateway.retryFailedMessage = vi.fn().mockRejectedValue(
      new WhatsAppRemoteError(
        'OUTBOUND_INTENT_CONFLICT',
        'Pending WhatsApp messages cannot be retried.',
      ),
    );
    const pending = await service.retryFailedMessage({
      messageId,
      outboundIntentKey: 'retry-intent-2',
    });
    expect(pending).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
  });

  it('does not require Current Operator claims for read-only media access and strips remote causes', async () => {
    const gateway = remote();
    const service = task9CService(gateway, async () => ({
      ok: true,
      value: { status: 'NO_ACTIVE_DAY', shopId },
    }));

    const result = await service.getMediaAccess(messageId);

    expect(gateway.getMediaAccess).toHaveBeenCalledWith(messageId);
    expect(result).toMatchObject({
      ok: true,
      value: { availability: 'AVAILABLE' },
    });
  });
});
