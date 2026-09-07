import type { ApplicationError, WhatsAppInboxSnapshot } from '@tux/application';
import type {
  DeviceId,
  Instant,
  WhatsAppConversation,
  WhatsAppLocationPayload,
  WhatsAppMessage,
  WorkerId,
} from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppInboxController,
  type WhatsAppInboxControllerEnvironment,
} from './whatsappInboxController';
import {
  WhatsAppMediaComposer,
  type WhatsAppAudioRecording,
  type WhatsAppMediaComposerEnvironment,
} from './whatsappMediaComposer';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const WORKER_ID = '22222222-2222-4222-8222-222222222222' as WorkerId;
const DEVICE_ID = '33333333-3333-4333-8333-333333333333' as DeviceId;

function ok<T>(value: T) {
  return { ok: true, value } as const;
}

function failure(message: string, code: ApplicationError['code'] = 'REMOTE_SYNC_ERROR') {
  return { ok: false, error: { code, message } } as const;
}

function conversation(id: string): WhatsAppConversation {
  return {
    id,
    shopId: SHOP_ID,
    normalizedPhone: '+201012345678',
    displayPhone: '010 1234 5678',
    customerName: 'Mona',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: '2026-09-05T10:00:00.000Z' as Instant,
  } as WhatsAppConversation;
}

function message(
  id: string,
  conversationId: string,
  overrides: Partial<WhatsAppMessage> = {},
): WhatsAppMessage {
  return {
    id,
    shopId: SHOP_ID,
    conversationId,
    providerMessageId: null,
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'TEXT',
    text: id,
    mediaRef: null,
    media: null,
    location: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-05T10:00:00.000Z' as Instant,
    ...overrides,
  } as WhatsAppMessage;
}

function outboundMessage(
  id: string,
  conversationId: string,
  overrides: Partial<WhatsAppMessage> = {},
): WhatsAppMessage {
  return message(id, conversationId, {
    direction: 'OUTBOUND',
    outboundIntentKey: `${id}-intent`,
    sentByWorkerId: WORKER_ID,
    initiatedByDeviceId: DEVICE_ID,
    initiatedAt: '2026-09-05T10:00:00.000Z' as Instant,
    status: 'SENT',
    ...overrides,
  });
}

function snapshot(
  selected: WhatsAppConversation,
  messages: readonly WhatsAppMessage[] = [],
): WhatsAppInboxSnapshot {
  return {
    conversations: [selected],
    messages,
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

class ControllerEnvironment implements WhatsAppInboxControllerEnvironment {
  online = true;
  hidden = false;
  counter = 0;
  readonly onlineListeners = new Set<() => void>();

  readonly nowMs = () => 1_000;
  readonly createIntentKey = vi.fn(() => `intent-${++this.counter}`);
  readonly setInterval = vi.fn(() => 1);
  readonly clearInterval = vi.fn();
  readonly setTimeout = vi.fn(() => 2);
  readonly clearTimeout = vi.fn();
  readonly isDocumentHidden = () => this.hidden;
  readonly isOnline = () => this.online;
  readonly addVisibilityListener = () => () => undefined;
  readonly addOnlineListener = (listener: () => void) => {
    this.onlineListeners.add(listener);
    return () => this.onlineListeners.delete(listener);
  };
  readonly addOfflineListener = () => () => undefined;

  fireOnline(): void {
    this.online = true;
    for (const listener of this.onlineListeners) listener();
  }
}

class MediaEnvironment implements WhatsAppMediaComposerEnvironment {
  currentLocation: WhatsAppLocationPayload = {
    latitude: 30.0444,
    longitude: 31.2357,
    name: null,
    address: null,
  };
  currentLocationError: Error | null = null;
  readonly revoked: string[] = [];

  readonly nowMs = () => 2_000;
  readonly createObjectUrl = () => 'blob:tux-preview';
  readonly revokeObjectUrl = (url: string) => this.revoked.push(url);
  readonly startAudioRecording = async (): Promise<WhatsAppAudioRecording> => ({
    stop: async () => ({ bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]), mimeType: 'audio/ogg' }),
    cancel: () => undefined,
  });
  readonly getCurrentLocation = async (): Promise<WhatsAppLocationPayload> => {
    if (this.currentLocationError !== null) throw this.currentLocationError;
    return this.currentLocation;
  };
}

function createClient(
  selected: WhatsAppConversation,
  selectedMessages: readonly WhatsAppMessage[] = [],
) {
  const loadInbox = vi
    .fn<TuxWhatsAppApi['loadInbox']>()
    .mockResolvedValue(ok(snapshot(selected, selectedMessages)));
  const loadConversation = vi
    .fn<TuxWhatsAppApi['loadConversation']>()
    .mockResolvedValue(ok(selectedMessages));
  const sendText = vi
    .fn<TuxWhatsAppApi['sendText']>()
    .mockResolvedValue(ok(outboundMessage('text-sent', selected.id)));
  const sendMedia = vi.fn<TuxWhatsAppApi['sendMedia']>().mockResolvedValue(
    ok(
      outboundMessage('media-sent', selected.id, {
        kind: 'IMAGE',
        text: null,
        mediaRef: 'a'.repeat(64),
        media: {
          mediaKey: 'a'.repeat(64),
          kind: 'IMAGE',
          mimeType: 'image/jpeg',
          fileName: 'photo.jpg',
          byteSize: 3,
          storedAt: '2026-09-05T10:00:00.000Z' as Instant,
          expiresAt: '2026-10-05T10:00:00.000Z' as Instant,
          availability: 'AVAILABLE',
        },
      }),
    ),
  );
  const sendLocation = vi.fn<TuxWhatsAppApi['sendLocation']>().mockResolvedValue(
    ok(
      outboundMessage('location-sent', selected.id, {
        kind: 'LOCATION',
        text: null,
        location: {
          latitude: 30.0444,
          longitude: 31.2357,
          name: 'TUX Downtown',
          address: 'Cairo',
        },
      }),
    ),
  );
  const retryFailedMessage = vi
    .fn<TuxWhatsAppApi['retryFailedMessage']>()
    .mockResolvedValue(ok(outboundMessage('retry-sent', selected.id)));
  const getMediaAccess = vi.fn<TuxWhatsAppApi['getMediaAccess']>().mockResolvedValue(
    ok({
      availability: 'AVAILABLE',
      url: 'https://storage.example/signed/object',
      expiresAt: '2026-09-05T10:05:00.000Z',
    }),
  );
  const resolveMessagingTarget = vi
    .fn<TuxWhatsAppApi['resolveMessagingTarget']>()
    .mockResolvedValue(
      ok({
        mode: 'FREE_FORM',
        conversationId: selected.id,
        freeFormUntil: '2026-09-05T11:00:00.000Z' as Instant,
        config: {
          storefrontUrl: 'https://tux.example/menu',
          storeLocation: {
            latitude: 30.0444,
            longitude: 31.2357,
            label: 'TUX Downtown',
            address: 'Cairo',
          },
        },
      }),
    );

  const api: TuxWhatsAppApi = {
    loadInbox,
    loadConversation,
    sendText,
    sendMedia,
    sendLocation,
    retryFailedMessage,
    getMediaAccess,
    resolveMessagingTarget,
    sendTemplate: vi.fn().mockResolvedValue(failure('not used')),
    markUnread: vi.fn().mockResolvedValue(ok(undefined)),
    archive: vi.fn().mockResolvedValue(ok(undefined)),
    setFollowUp: vi.fn().mockResolvedValue(ok(undefined)),
    linkOrder: vi.fn().mockResolvedValue(ok(undefined)),
    saveDraft: vi.fn().mockResolvedValue(ok(undefined)),
    getDraft: vi.fn().mockResolvedValue(ok(null)),
    resolveCustomerOrderContext: vi.fn().mockResolvedValue(
      ok({
        kind: 'NO_ACTIVE_ORDER',
        customer: {
          normalizedPhone: selected.normalizedPhone,
          displayPhone: selected.displayPhone,
          customerName: selected.customerName ?? selected.displayPhone,
          address: null,
          zoneId: null,
        },
        activeOrders: [],
      }),
    ),
  };

  return {
    api,
    loadInbox,
    sendMedia,
    sendLocation,
    retryFailedMessage,
    getMediaAccess,
    resolveMessagingTarget,
  };
}

async function loadController(selectedMessages: readonly WhatsAppMessage[] = []) {
  const selected = conversation('conversation-1');
  const client = createClient(selected, selectedMessages);
  const environment = new ControllerEnvironment();
  const mediaEnvironment = new MediaEnvironment();
  const mediaComposer = new WhatsAppMediaComposer(mediaEnvironment);
  const controller = new WhatsAppInboxController(
    client.api,
    environment,
    mediaComposer,
  ) as WhatsAppInboxController & Record<string, (...args: never[]) => unknown>;
  await controller.refresh();
  return { controller, client, environment, mediaEnvironment, selected };
}

describe('WhatsAppInboxController Task 9D media/location sends', () => {
  it('keeps attachment selection transient and sends only after explicit Send', async () => {
    const { controller, client, environment, selected } = await loadController();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);

    controller.selectMediaFile({ bytes, mimeType: 'image/jpeg', fileName: 'photo.jpg' });

    expect(controller.getState()).toMatchObject({
      mediaComposerState: {
        kind: 'FILE_READY',
        mediaKind: 'IMAGE',
        fileName: 'photo.jpg',
      },
    });
    expect(client.sendMedia).not.toHaveBeenCalled();

    await controller.sendCurrentMedia();

    expect(client.sendMedia).toHaveBeenCalledExactlyOnceWith({
      conversationId: selected.id,
      outboundIntentKey: 'intent-1',
      media: { kind: 'IMAGE', bytes, mimeType: 'image/jpeg', fileName: 'photo.jpg' },
    });
    expect(environment.createIntentKey).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({ mediaComposerState: { kind: 'IDLE' } });
  });

  it('preserves the exact attachment after send failure and never replays it on reconnect', async () => {
    const { controller, client, environment } = await loadController();
    client.sendMedia.mockResolvedValueOnce(failure('Safe media failure'));
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    controller.selectMediaFile({ bytes, mimeType: 'image/jpeg', fileName: 'photo.jpg' });

    await controller.sendCurrentMedia();

    expect(controller.getState()).toMatchObject({
      errorMessage: 'Safe media failure',
      mediaComposerState: { kind: 'FILE_READY', fileName: 'photo.jpg' },
    });
    expect(client.sendMedia).toHaveBeenCalledTimes(1);

    controller.start();
    environment.online = false;
    environment.fireOnline();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.sendMedia).toHaveBeenCalledTimes(1);
  });

  it('sends configured Store Location and keeps Current Location denial non-fatal', async () => {
    const { controller, client, mediaEnvironment, selected } = await loadController();

    await controller.sendStoreLocation();

    expect(client.sendLocation).toHaveBeenCalledExactlyOnceWith({
      conversationId: selected.id,
      outboundIntentKey: 'intent-1',
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Downtown',
        address: 'Cairo',
      },
    });

    mediaEnvironment.currentLocationError = new Error('Permission denied with platform details');
    await controller.sendCurrentLocation();

    expect(client.sendLocation).toHaveBeenCalledTimes(1);
    expect(controller.getState().errorMessage).toBe('Current location is unavailable.');
    expect(controller.getState().messagingTarget?.config.storeLocation?.label).toBe('TUX Downtown');
  });

  it('preserves attachment and refreshes policy once when FREE_FORM_WINDOW_CLOSED is returned', async () => {
    const { controller, client } = await loadController();
    client.sendMedia.mockResolvedValueOnce(
      failure(
        'The WhatsApp free-form messaging window has closed.',
        'WHATSAPP_FREE_FORM_WINDOW_CLOSED',
      ),
    );
    client.resolveMessagingTarget.mockResolvedValueOnce(
      ok({
        mode: 'TEMPLATE_ONLY',
        conversationId: 'conversation-1',
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
        templates: [],
        config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
      }),
    );
    controller.selectMediaFile({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
    });

    await controller.sendCurrentMedia();

    expect(controller.getState()).toMatchObject({
      mediaComposerState: { kind: 'FILE_READY', fileName: 'photo.jpg' },
      messagingTarget: { mode: 'TEMPLATE_ONLY' },
    });
  });
});

describe('WhatsAppInboxController Task 9D retry/media access', () => {
  it('allows explicit retry only for FAILED outbound messages and sends only message ID plus a new intent key', async () => {
    const failed = outboundMessage('failed', 'conversation-1', { status: 'FAILED' });
    const pending = outboundMessage('pending', 'conversation-1', { status: 'PENDING' });
    const { controller, client } = await loadController([failed, pending]);

    await controller.retryFailedMessage(pending.id);
    expect(client.retryFailedMessage).not.toHaveBeenCalled();

    await controller.retryFailedMessage(failed.id);

    expect(client.retryFailedMessage).toHaveBeenCalledExactlyOnceWith({
      messageId: failed.id,
      outboundIntentKey: 'intent-1',
    });
  });

  it('keeps short-lived media access in transient controller state and exposes expired state explicitly', async () => {
    const available = message('available', 'conversation-1', {
      kind: 'IMAGE',
      text: null,
      mediaRef: 'a'.repeat(64),
      media: {
        mediaKey: 'a'.repeat(64),
        kind: 'IMAGE',
        mimeType: 'image/jpeg',
        fileName: 'photo.jpg',
        byteSize: 3,
        storedAt: '2026-09-05T10:00:00.000Z' as Instant,
        expiresAt: '2026-10-05T10:00:00.000Z' as Instant,
        availability: 'AVAILABLE',
      },
    });
    const { controller, client } = await loadController([available]);

    await controller.loadMediaAccess(available.id);
    expect(controller.getState()).toMatchObject({
      mediaAccessByMessageId: {
        [available.id]: {
          availability: 'AVAILABLE',
          url: 'https://storage.example/signed/object',
        },
      },
    });

    client.getMediaAccess.mockResolvedValueOnce(
      ok({ availability: 'EXPIRED', url: null, expiresAt: null }),
    );
    await controller.loadMediaAccess(available.id);
    expect(controller.getState()).toMatchObject({
      mediaAccessByMessageId: {
        [available.id]: { availability: 'EXPIRED', url: null },
      },
    });
  });

  it('cancels transient attachment state when changing conversations or stopping the controller', async () => {
    const { controller, mediaEnvironment } = await loadController();
    controller.selectMediaFile({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      fileName: 'photo.jpg',
    });

    controller.stop();

    expect(mediaEnvironment.revoked).toEqual(['blob:tux-preview']);
    expect(controller.getState()).toMatchObject({ mediaComposerState: { kind: 'IDLE' } });
  });
});
