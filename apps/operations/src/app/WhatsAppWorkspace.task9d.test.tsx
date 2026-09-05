import type { WhatsAppInboxSnapshot } from '@tux/application';
import type { Instant, WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import { Children, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppWorkspace, type WhatsAppWorkspaceController } from './WhatsAppWorkspace';
import type { WhatsAppInboxUiState } from './whatsappInboxController';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-05T10:00:00.000Z' as Instant;
const EXPIRES = '2026-10-05T10:00:00.000Z' as Instant;

function conversation(): WhatsAppConversation {
  return {
    id: 'conversation-1',
    shopId: SHOP_ID,
    normalizedPhone: '+201012345678',
    displayPhone: '010 1234 5678',
    customerName: 'Mona',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: NOW,
  } as WhatsAppConversation;
}

function message(id: string, overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    id,
    shopId: SHOP_ID,
    conversationId: 'conversation-1',
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
    createdAt: NOW,
    ...overrides,
  } as WhatsAppMessage;
}

function binaryMessage(
  id: string,
  kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO',
  fileName: string | null,
  availability: 'AVAILABLE' | 'EXPIRED' = 'AVAILABLE',
): WhatsAppMessage {
  const mediaKey = id.slice(0, 1).repeat(64);
  const mimeType =
    kind === 'IMAGE' ? 'image/jpeg' : kind === 'AUDIO' ? 'audio/ogg' : 'application/pdf';
  return message(id, {
    kind,
    text: null,
    mediaRef: mediaKey,
    media: {
      mediaKey,
      kind,
      mimeType,
      fileName,
      byteSize: 3,
      storedAt: NOW,
      expiresAt: EXPIRES,
      availability,
    },
  });
}

function snapshot(messages: readonly WhatsAppMessage[]): WhatsAppInboxSnapshot {
  const selected = conversation();
  return {
    conversations: [selected],
    messages,
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

function freeFormTarget(): NonNullable<WhatsAppInboxUiState['messagingTarget']> {
  return {
    mode: 'FREE_FORM',
    conversationId: 'conversation-1',
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
  } as NonNullable<WhatsAppInboxUiState['messagingTarget']>;
}

function state(
  messages: readonly WhatsAppMessage[] = [],
  overrides: Partial<WhatsAppInboxUiState> = {},
): WhatsAppInboxUiState {
  const inbox = snapshot(messages);
  return {
    snapshot: inbox,
    visibleConversations: inbox.conversations,
    selectedConversationId: 'conversation-1',
    selectedMessages: messages,
    filter: 'ALL',
    search: '',
    totalUnread: 0,
    refreshing: false,
    networkOffline: false,
    lastRefreshedAt: 1_000,
    errorMessage: null,
    composerText: '',
    sendBusy: false,
    customerOrderContext: null,
    messagingTarget: freeFormTarget(),
    contextBusy: false,
    mediaComposerState: { kind: 'IDLE' },
    mediaAccessByMessageId: {},
    ...overrides,
  };
}

type TestElement = ReactElement<Record<string, unknown>>;

function isElement(node: ReactNode): node is TestElement {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node;
}

function findElement(node: ReactNode, predicate: (element: TestElement) => boolean): TestElement {
  let match: TestElement | null = null;
  function visit(current: ReactNode): void {
    if (match !== null) return;
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isElement(current)) return;
    if (predicate(current)) {
      match = current;
      return;
    }
    Children.forEach(current.props['children'] as ReactNode, visit);
  }
  visit(node);
  if (match === null) throw new Error('Expected React element was not found.');
  return match;
}

function createController() {
  const mocks = {
    sendCurrentMedia: vi.fn().mockResolvedValue(undefined),
    cancelMedia: vi.fn(),
    startVoiceRecording: vi.fn().mockResolvedValue(undefined),
    stopVoiceRecording: vi.fn().mockResolvedValue(undefined),
    sendStoreLocation: vi.fn().mockResolvedValue(undefined),
    sendCurrentLocation: vi.fn().mockResolvedValue(undefined),
    retryFailedMessage: vi.fn().mockResolvedValue(undefined),
    loadMediaAccess: vi.fn().mockResolvedValue(undefined),
  };
  const controller = {
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    selectConversation: vi.fn().mockResolvedValue(undefined),
    insertQuickReply: vi.fn(),
    insertMenuReply: vi.fn(),
    sendSelectedTemplate: vi.fn().mockResolvedValue(undefined),
    setComposerText: vi.fn(),
    sendCurrentText: vi.fn().mockResolvedValue(undefined),
    markUnread: vi.fn().mockResolvedValue(undefined),
    setArchived: vi.fn().mockResolvedValue(undefined),
    setFollowUp: vi.fn().mockResolvedValue(undefined),
    linkSelectedOrder: vi.fn().mockResolvedValue(undefined),
    ...mocks,
  } as unknown as WhatsAppWorkspaceController;
  return { controller, mocks };
}

function render(uiState: WhatsAppInboxUiState): string {
  return renderToStaticMarkup(
    <WhatsAppWorkspace controller={createController().controller} state={uiState} />,
  );
}

describe('WhatsAppWorkspace Task 9D media presentation', () => {
  it('renders safe image/document/audio/location content and keeps expired media visible in history', () => {
    const image = binaryMessage('a-image', 'IMAGE', 'photo.jpg');
    const document = binaryMessage('b-document', 'DOCUMENT', 'report.pdf');
    const audio = binaryMessage('c-audio', 'AUDIO', null);
    const expired = binaryMessage('d-expired', 'IMAGE', 'old.jpg', 'EXPIRED');
    const location = message('location', {
      kind: 'LOCATION',
      text: null,
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Downtown',
        address: 'Cairo',
      },
    });

    const markup = render(
      state([image, document, audio, location, expired], {
        mediaAccessByMessageId: {
          [image.id]: {
            availability: 'AVAILABLE',
            url: 'https://storage.example/image',
            expiresAt: '2026-09-05T10:05:00.000Z',
          },
          [document.id]: {
            availability: 'AVAILABLE',
            url: 'https://storage.example/document',
            expiresAt: '2026-09-05T10:05:00.000Z',
          },
          [audio.id]: {
            availability: 'AVAILABLE',
            url: 'https://storage.example/audio',
            expiresAt: '2026-09-05T10:05:00.000Z',
          },
          [expired.id]: { availability: 'EXPIRED', url: null, expiresAt: null },
        },
      }),
    );

    expect(markup).toContain('<img');
    expect(markup).toContain('https://storage.example/image');
    expect(markup).toContain('report.pdf');
    expect(markup).toContain('https://storage.example/document');
    expect(markup).toContain('<audio');
    expect(markup).toContain('https://storage.example/audio');
    expect(markup).toContain('TUX Downtown');
    expect(markup).toContain('Cairo');
    expect(markup).toContain('30.0444');
    expect(markup).toContain('31.2357');
    expect(markup).toContain('Media expired');
    expect(markup).not.toContain('provider-media-id');
    expect(markup).not.toContain('graph.facebook.com');
  });

  it('requests short-lived media access from an explicit history action when access is not loaded', () => {
    const image = binaryMessage('a-image', 'IMAGE', 'photo.jpg');
    const { controller, mocks } = createController();
    const tree = WhatsAppWorkspace({ controller, state: state([image]) });
    const load = findElement(
      tree,
      (element) => element.props['data-whatsapp-load-media'] === image.id,
    );

    (load.props['onClick'] as () => void)();

    expect(mocks.loadMediaAccess).toHaveBeenCalledExactlyOnceWith(image.id);
  });

  it('exposes explicit Retry for FAILED outbound only and never for PENDING uncertainty', () => {
    const failed = message('failed', {
      direction: 'OUTBOUND',
      outboundIntentKey: 'failed-intent',
      status: 'FAILED',
    });
    const pending = message('pending', {
      direction: 'OUTBOUND',
      outboundIntentKey: 'pending-intent',
      status: 'PENDING',
    });
    const { controller, mocks } = createController();
    const tree = WhatsAppWorkspace({ controller, state: state([failed, pending]) });
    const markup = renderToStaticMarkup(tree);
    const retry = findElement(
      tree,
      (element) => element.props['data-whatsapp-retry-message'] === failed.id,
    );

    (retry.props['onClick'] as () => void)();

    expect(mocks.retryFailedMessage).toHaveBeenCalledExactlyOnceWith(failed.id);
    expect(markup.match(/data-whatsapp-retry-message=/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain(`data-whatsapp-retry-message="${pending.id}"`);
  });
});

describe('WhatsAppWorkspace Task 9D composer extensions', () => {
  it('keeps attachment, voice, Store Location, and Current Location compact in FREE_FORM', () => {
    const { controller, mocks } = createController();
    const uiState = state([], {
      mediaComposerState: {
        kind: 'FILE_READY',
        mediaKind: 'IMAGE',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        previewUrl: 'blob:tux-photo',
      },
    });
    const tree = WhatsAppWorkspace({ controller, state: uiState });
    const markup = renderToStaticMarkup(tree);

    expect(markup).toContain('type="file"');
    expect(markup).toContain('data-whatsapp-attachment="true"');
    expect(markup).toContain('Record voice');
    expect(markup).toContain('Store Location');
    expect(markup).toContain('Current Location');
    expect(markup).toContain('photo.jpg');
    expect(markup).toContain('blob:tux-photo');
    expect(markup).toContain('Send attachment');
    expect(markup).toContain('Cancel');

    const sendMedia = findElement(
      tree,
      (element) => element.props['data-whatsapp-send-media'] === true,
    );
    const cancel = findElement(
      tree,
      (element) => element.props['data-whatsapp-cancel-media'] === true,
    );
    const store = findElement(
      tree,
      (element) => element.props['data-whatsapp-store-location'] === true,
    );
    const current = findElement(
      tree,
      (element) => element.props['data-whatsapp-current-location'] === true,
    );
    const voice = findElement(
      tree,
      (element) => element.props['data-whatsapp-record-voice'] === true,
    );

    (sendMedia.props['onClick'] as () => void)();
    (cancel.props['onClick'] as () => void)();
    (store.props['onClick'] as () => void)();
    (current.props['onClick'] as () => void)();
    (voice.props['onClick'] as () => void)();

    expect(mocks.sendCurrentMedia).toHaveBeenCalledTimes(1);
    expect(mocks.cancelMedia).toHaveBeenCalledTimes(1);
    expect(mocks.sendStoreLocation).toHaveBeenCalledTimes(1);
    expect(mocks.sendCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mocks.startVoiceRecording).toHaveBeenCalledTimes(1);
  });

  it('renders direct voice Record → Stop → Preview → Send / Cancel states', () => {
    const recording = render(
      state([], { mediaComposerState: { kind: 'RECORDING', startedAtMs: 1000 } }),
    );
    const ready = render(
      state([], {
        mediaComposerState: {
          kind: 'AUDIO_READY',
          bytes: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
          mimeType: 'audio/ogg',
          previewUrl: 'blob:tux-audio',
        },
      }),
    );

    expect(recording).toContain('Recording…');
    expect(recording).toContain('Stop recording');
    expect(recording).toContain('Cancel');
    expect(ready).toContain('<audio');
    expect(ready).toContain('blob:tux-audio');
    expect(ready).toContain('Send voice');
    expect(ready).toContain('Cancel');
  });

  it.each(['TEMPLATE_ONLY', 'BLOCKED'] as const)(
    'does not expose free-form media/location controls while policy is %s',
    (mode) => {
      const messagingTarget =
        mode === 'TEMPLATE_ONLY'
          ? ({
              mode,
              conversationId: 'conversation-1',
              normalizedPhone: '+201012345678',
              displayPhone: '010 1234 5678',
              templates: [],
              config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
            } as NonNullable<WhatsAppInboxUiState['messagingTarget']>)
          : ({
              mode,
              conversationId: 'conversation-1',
              reason: 'NO_APPROVED_TEMPLATE',
              config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
            } as NonNullable<WhatsAppInboxUiState['messagingTarget']>);
      const markup = render(state([], { messagingTarget }));

      expect(markup).not.toContain('data-whatsapp-attachment="true"');
      expect(markup).not.toContain('data-whatsapp-record-voice="true"');
      expect(markup).not.toContain('data-whatsapp-store-location="true"');
      expect(markup).not.toContain('data-whatsapp-current-location="true"');
    },
  );
});
