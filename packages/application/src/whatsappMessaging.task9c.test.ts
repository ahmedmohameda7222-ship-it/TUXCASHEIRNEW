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

interface Task9CGateway {
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

interface Task9CService {
  sendMedia(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: {
      readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly fileName: string | null;
    };
  }): Promise<unknown>;

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

function active(worker: WorkerId = workerId): OperationsSessionResult {
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

function sentMessage(kind: WhatsAppMessage['kind']): WhatsAppMessage {
  return {
    id: messageId,
    shopId,
    conversationId,
    providerMessageId: 'wamid.outbound',
    outboundIntentKey: 'intent-outbound',
    direction: 'OUTBOUND',
    kind,
    text: kind === 'TEXT' ? 'ok' : null,
    mediaRef: null,
    media: null,
    location:
      kind === 'LOCATION'
        ? {
            latitude: 30.0444,
            longitude: 31.2357,
            name: 'TUX Store',
            address: 'Cairo',
          }
        : null,
    status: 'SENT',
    sentByWorkerId: workerId,
    initiatedByDeviceId: parseEntityId('60000000-0000-4000-8000-000000000001'),
    initiatedAt: instant('2026-09-04T10:00:00.000Z'),
    createdAt: instant('2026-09-04T10:00:00.000Z'),
  };
}

function gateway(): WhatsAppRemoteGateway & Task9CGateway {
  return {
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    resolveMessagingTarget: vi.fn(),
    sendText: vi.fn(),
    sendTemplate: vi.fn(),
    sendMedia: vi.fn().mockResolvedValue(sentMessage('IMAGE')),
    sendLocation: vi.fn().mockResolvedValue(sentMessage('LOCATION')),
    retryFailedMessage: vi.fn().mockResolvedValue(sentMessage('TEXT')),
    getMediaAccess: vi.fn().mockResolvedValue({
      availability: 'AVAILABLE',
      url: 'https://signed.example/media',
      expiresAt: '2026-09-04T10:05:00.000Z',
    }),
    markUnread: vi.fn(),
    archive: vi.fn(),
    setFollowUp: vi.fn(),
    linkOrder: vi.fn(),
  };
}

function service(
  remote: WhatsAppRemoteGateway,
  getState: () => Promise<OperationsSessionResult>,
): Task9CService {
  return new OperationsWhatsAppMessagingService(remote, { getState }) as unknown as Task9CService;
}

describe('Task 9C messaging capability', () => {
  it('uses fresh worker claims for media send', async () => {
    const remote = gateway();
    let state = active();
    const sut = service(remote, async () => state);
    const media = {
      kind: 'IMAGE' as const,
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
    };

    expect(remote.sendMedia).not.toHaveBeenCalled();
    await sut.sendMedia({ conversationId, outboundIntentKey: 'media-1', media });
    state = active(workerId2);
    await sut.sendMedia({ conversationId, outboundIntentKey: 'media-2', media });

    expect(remote.sendMedia).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'media-1',
      media,
    });
    expect(remote.sendMedia).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      conversationId,
      outboundIntentKey: 'media-2',
      media,
    });
  });

  it('does not queue media offline', async () => {
    const remote = gateway();
    remote.sendMedia = vi.fn().mockRejectedValue(
      new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.'),
    );
    const sut = service(remote, async () => active());

    const result = await sut.sendMedia({
      conversationId,
      outboundIntentKey: 'media-failed',
      media: {
        kind: 'DOCUMENT',
        bytes: new TextEncoder().encode('%PDF-1.7'),
        mimeType: 'application/pdf',
        fileName: 'invoice.pdf',
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'REMOTE_SYNC_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('signed.example');
  });

  it('validates location before remote send', async () => {
    const remote = gateway();
    const sut = service(remote, async () => active());

    const invalid = await sut.sendLocation({
      conversationId,
      outboundIntentKey: 'location-invalid',
      location: {
        latitude: 91,
        longitude: 31.2357,
        name: null,
        address: null,
      },
    });

    expect(invalid).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(remote.sendLocation).not.toHaveBeenCalled();
  });

  it('supports explicit retry and read-only media access', async () => {
    const remote = gateway();
    const sut = service(remote, async () => active());

    await sut.retryFailedMessage({
      messageId,
      outboundIntentKey: 'retry-1',
    });
    const access = await sut.getMediaAccess(messageId);

    expect(remote.retryFailedMessage).toHaveBeenCalledWith({
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-1',
    });
    expect(remote.getMediaAccess).toHaveBeenCalledWith(messageId);
    expect(access).toMatchObject({
      ok: true,
      value: { availability: 'AVAILABLE' },
    });
  });
});
