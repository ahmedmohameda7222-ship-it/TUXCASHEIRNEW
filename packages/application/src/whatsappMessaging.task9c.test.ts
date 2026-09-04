import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
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

type Media = {
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string | null;
};

type Location = {
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string | null;
  readonly address: string | null;
};

type Task9CService = {
  sendMedia(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: Media;
  }): Promise<unknown>;
  sendLocation(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: Location;
  }): Promise<unknown>;
  retryFailedMessage(input: {
    readonly messageId: string;
    readonly outboundIntentKey: string;
  }): Promise<unknown>;
  getMediaAccess(messageId: string): Promise<unknown>;
};

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

function createRemote() {
  const sendMedia = vi.fn().mockResolvedValue({});
  const sendLocation = vi.fn().mockResolvedValue({});
  const retryFailedMessage = vi.fn().mockResolvedValue({});
  const getMediaAccess = vi.fn().mockResolvedValue({
    availability: 'AVAILABLE',
    url: 'https://signed.example/media',
    expiresAt: '2026-09-04T10:05:00.000Z',
  });
  const remote = {
    loadInbox: vi.fn(),
    resolveMessagingTarget: vi.fn(),
    sendText: vi.fn(),
    sendTemplate: vi.fn(),
    markUnread: vi.fn(),
    archive: vi.fn(),
    setFollowUp: vi.fn(),
    linkOrder: vi.fn(),
    sendMedia,
    sendLocation,
    retryFailedMessage,
    getMediaAccess,
  } as unknown as WhatsAppRemoteGateway;
  return { remote, sendMedia, sendLocation, retryFailedMessage, getMediaAccess };
}

function service(
  remote: WhatsAppRemoteGateway,
  getState: () => Promise<OperationsSessionResult>,
): Task9CService {
  return new OperationsWhatsAppMessagingService(remote, { getState }) as unknown as Task9CService;
}

describe('Task 9C messaging capability', () => {
  it('uses fresh worker claims for media send', async () => {
    const fixture = createRemote();
    let state = active();
    const sut = service(fixture.remote, async () => state);
    const media: Media = {
      kind: 'IMAGE',
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
    };

    expect(fixture.sendMedia).not.toHaveBeenCalled();
    await sut.sendMedia({ conversationId, outboundIntentKey: 'media-1', media });
    state = active(workerId2);
    await sut.sendMedia({ conversationId, outboundIntentKey: 'media-2', media });

    expect(fixture.sendMedia).toHaveBeenNthCalledWith(1, {
      businessDayId,
      workerId,
      conversationId,
      outboundIntentKey: 'media-1',
      media,
    });
    expect(fixture.sendMedia).toHaveBeenNthCalledWith(2, {
      businessDayId,
      workerId: workerId2,
      conversationId,
      outboundIntentKey: 'media-2',
      media,
    });
  });

  it('does not queue media offline or persist a signed URL', async () => {
    const fixture = createRemote();
    fixture.sendMedia.mockRejectedValue(
      new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is unavailable.'),
    );
    const sut = service(fixture.remote, async () => active());

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
    expect(fixture.sendMedia).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('signed.example');
  });

  it('validates location before remote send', async () => {
    const fixture = createRemote();
    const sut = service(fixture.remote, async () => active());

    const result = await sut.sendLocation({
      conversationId,
      outboundIntentKey: 'location-invalid',
      location: {
        latitude: 91,
        longitude: 31.2357,
        name: null,
        address: null,
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(fixture.sendLocation).not.toHaveBeenCalled();
  });

  it('supports explicit retry and refuses uncertain retry', async () => {
    const fixture = createRemote();
    const sut = service(fixture.remote, async () => active());

    await sut.retryFailedMessage({ messageId, outboundIntentKey: 'retry-1' });
    expect(fixture.retryFailedMessage).toHaveBeenCalledWith({
      businessDayId,
      workerId,
      messageId,
      outboundIntentKey: 'retry-1',
    });

    fixture.retryFailedMessage.mockRejectedValue(
      new WhatsAppRemoteError(
        'OUTBOUND_INTENT_CONFLICT',
        'Pending WhatsApp messages cannot be retried.',
      ),
    );
    const pending = await sut.retryFailedMessage({
      messageId,
      outboundIntentKey: 'retry-2',
    });
    expect(pending).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });
  });

  it('allows read-only media access without active worker claims', async () => {
    const fixture = createRemote();
    const sut = service(fixture.remote, async () => ({
      ok: true,
      value: { status: 'NO_ACTIVE_DAY', shopId },
    }));

    const result = await sut.getMediaAccess(messageId);

    expect(fixture.getMediaAccess).toHaveBeenCalledWith(messageId);
    expect(result).toMatchObject({
      ok: true,
      value: { availability: 'AVAILABLE' },
    });
  });
});
