import type { WhatsAppInboxSnapshot } from '@tux/application';
import type {
  Instant,
  OrderId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';
import { Children, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppWorkspace, type WhatsAppWorkspaceController } from './WhatsAppWorkspace';
import type { WhatsAppInboxUiState } from './whatsappInboxController';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const LINKED_ORDER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrderId;

function conversation(
  id: string,
  overrides: Partial<WhatsAppConversation> = {},
): WhatsAppConversation {
  return {
    id,
    shopId: SHOP_ID,
    normalizedPhone: `+2010${id.length}000000`,
    displayPhone: `010 ${id.length}00 0000`,
    customerName: id,
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: '2026-09-03T12:34:00.000Z',
    ...overrides,
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
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-03T12:34:00.000Z',
    ...overrides,
  } as WhatsAppMessage;
}

function quickReply(
  id: string,
  text: string,
  overrides: Partial<WhatsAppQuickReply> = {},
): WhatsAppQuickReply {
  return {
    id,
    shopId: SHOP_ID,
    category: 'PREPARATION',
    language: 'ar-EG',
    text,
    usageCount: 1,
    active: true,
    ...overrides,
  } as WhatsAppQuickReply;
}

function snapshot(
  conversations: readonly WhatsAppConversation[],
  messages: readonly WhatsAppMessage[],
  quickReplies: readonly WhatsAppQuickReply[] = [],
): WhatsAppInboxSnapshot {
  return {
    conversations,
    messages,
    quickReplies,
    orderLinks: [],
    nextCursor: null,
  };
}

function state(overrides: Partial<WhatsAppInboxUiState> = {}): WhatsAppInboxUiState {
  const selected = conversation('Mona', {
    unreadCount: 4,
    followUp: true,
    context: 'DIRECT',
  });
  const inbox = snapshot(
    [selected],
    [message('Last message preview', selected.id)],
    [
      quickReply('active-reply', 'أوردر حضرتك جاهز.'),
      quickReply('inactive-reply', 'Do not render', { active: false }),
    ],
  );
  return {
    snapshot: inbox,
    visibleConversations: inbox.conversations,
    selectedConversationId: selected.id,
    selectedMessages: inbox.messages,
    filter: 'ALL',
    search: '',
    totalUnread: 4,
    refreshing: false,
    networkOffline: false,
    lastRefreshedAt: 1_000,
    errorMessage: null,
    composerText: '',
    sendBusy: false,
    customerOrderContext: null,
    contextBusy: false,
    ...overrides,
  };
}

function createController() {
  return {
    setFilter: vi.fn<WhatsAppWorkspaceController['setFilter']>(),
    setSearch: vi.fn<WhatsAppWorkspaceController['setSearch']>(),
    selectConversation: vi
      .fn<WhatsAppWorkspaceController['selectConversation']>()
      .mockResolvedValue(),
    insertQuickReply: vi.fn<WhatsAppWorkspaceController['insertQuickReply']>(),
    setComposerText: vi.fn<WhatsAppWorkspaceController['setComposerText']>(),
    sendCurrentText: vi.fn<WhatsAppWorkspaceController['sendCurrentText']>().mockResolvedValue(),
    markUnread: vi.fn<WhatsAppWorkspaceController['markUnread']>().mockResolvedValue(),
    setArchived: vi.fn<WhatsAppWorkspaceController['setArchived']>().mockResolvedValue(),
    setFollowUp: vi.fn<WhatsAppWorkspaceController['setFollowUp']>().mockResolvedValue(),
    linkSelectedOrder: vi
      .fn<WhatsAppWorkspaceController['linkSelectedOrder']>()
      .mockResolvedValue(),
  } satisfies WhatsAppWorkspaceController;
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

function render(uiState: WhatsAppInboxUiState, controller = createController()): string {
  return renderToStaticMarkup(<WhatsAppWorkspace controller={controller} state={uiState} />);
}

describe('WhatsAppWorkspace', () => {
  it('locks the approved premium two-pane hierarchy without a permanent inspector', () => {
    const markup = render(state());

    expect(markup.match(/data-whatsapp-pane="rail"/g) ?? []).toHaveLength(1);
    expect(markup.match(/data-whatsapp-pane="detail"/g) ?? []).toHaveLength(1);
    expect(markup).not.toContain('data-whatsapp-pane="inspector"');
    expect(markup).toContain('data-whatsapp-region="conversation-list"');
    expect(markup).toContain('data-whatsapp-region="conversation-header"');
    expect(markup).toContain('data-whatsapp-region="message-history"');
    expect(markup).toContain('data-whatsapp-region="composer"');

    const headerIndex = markup.indexOf('data-whatsapp-region="conversation-header"');
    const historyIndex = markup.indexOf('data-whatsapp-region="message-history"');
    const composerIndex = markup.indexOf('data-whatsapp-region="composer"');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(historyIndex).toBeGreaterThan(headerIndex);
    expect(composerIndex).toBeGreaterThan(historyIndex);
  });

  it('renders a desktop-first two-pane rail and active conversation panel with required row metadata', () => {
    const markup = render(state());

    expect(markup).toContain('aria-label="WhatsApp inbox"');
    expect(markup).toContain('whatsapp-conversation-rail');
    expect(markup).toContain('whatsapp-conversation-panel');
    expect(markup).toContain('placeholder="Search conversations"');
    expect(markup).toContain('>All<');
    expect(markup).toContain('>Unread<');
    expect(markup).toContain('>Follow-up<');
    expect(markup).toContain('>Archived<');
    expect(markup).toContain('Mona');
    expect(markup).toContain('Direct WhatsApp');
    expect(markup).toContain('Last message preview');
    expect(markup).toContain('whatsapp-conversation-unread');
    expect(markup).toContain('Follow-up');
    expect(markup).toContain('<time');
  });

  it('delegates search, filter, and conversation selection to the controller', () => {
    const controller = createController();
    const tree = WhatsAppWorkspace({ controller, state: state() });

    const search = findElement(tree, (element) => element.props['data-whatsapp-search'] === true);
    (search.props['onChange'] as (event: { target: { value: string } }) => void)({
      target: { value: '010' },
    });

    const unread = findElement(
      tree,
      (element) => element.props['data-whatsapp-filter'] === 'UNREAD',
    );
    (unread.props['onClick'] as () => void)();

    const row = findElement(tree, (element) => element.props['data-conversation-id'] === 'Mona');
    (row.props['onClick'] as () => void)();

    expect(controller.setSearch).toHaveBeenCalledWith('010');
    expect(controller.setFilter).toHaveBeenCalledWith('UNREAD');
    expect(controller.selectConversation).toHaveBeenCalledWith('Mona');
  });

  it.each([
    ['DIRECT', 'Direct WhatsApp'],
    ['WEB_REQUEST', 'Website Order Request'],
    ['ORDER_LINKED', 'Existing Order Chat'],
  ] as const)(
    'renders %s context as %s without exposing the raw linked-order UUID',
    (context, label) => {
      const selected = conversation('Customer', {
        context,
        linkedOrderId: LINKED_ORDER_ID as WhatsAppConversation['linkedOrderId'],
      });
      const inbox = snapshot([selected], []);
      const markup = render(
        state({
          snapshot: inbox,
          visibleConversations: inbox.conversations,
          selectedConversationId: selected.id,
          selectedMessages: [],
        }),
      );

      expect(markup).toContain(label);
      expect(markup).toContain('Order linked');
      expect(markup).not.toContain(LINKED_ORDER_ID);
      expect(markup).not.toContain('Order #');
    },
  );

  it('renders bidi-safe text, distinct inbound/outbound bubbles, system presentation, and safe media placeholders', () => {
    const selected = conversation('Chat');
    const selectedMessages = [
      message('inbound', selected.id, { text: 'مرحبا Ahmed 010', direction: 'INBOUND' }),
      message('outbound', selected.id, {
        text: 'Thanks شكراً',
        direction: 'OUTBOUND',
        status: 'READ',
      }),
      message('image', selected.id, {
        kind: 'IMAGE',
        text: null,
        mediaRef: 'https://provider.invalid/image',
      }),
      message('document', selected.id, {
        kind: 'DOCUMENT',
        text: null,
        mediaRef: 'provider-document-secret',
      }),
      message('audio', selected.id, {
        kind: 'AUDIO',
        text: null,
        mediaRef: 'provider-audio-secret',
      }),
      message('location', selected.id, {
        kind: 'LOCATION',
        text: null,
        mediaRef: 'provider-location-secret',
      }),
      message('system', selected.id, {
        kind: 'SYSTEM',
        text: 'Internal status',
        direction: 'INBOUND',
      }),
    ];
    const inbox = snapshot([selected], []);
    const markup = render(
      state({
        snapshot: inbox,
        visibleConversations: inbox.conversations,
        selectedConversationId: selected.id,
        selectedMessages,
      }),
    );

    expect(markup).toContain('dir="auto"');
    expect(markup).toContain('whatsapp-message-inbound');
    expect(markup).toContain('whatsapp-message-outbound');
    expect(markup).toContain('whatsapp-message-system');
    expect(markup).toContain('Image message');
    expect(markup).toContain('Document message');
    expect(markup).toContain('Voice / audio message');
    expect(markup).toContain('Location message');
    expect(markup).not.toContain('https://provider.invalid/image');
    expect(markup).not.toContain('provider-document-secret');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('<audio');
  });

  it('renders every outbound delivery state without adding automatic resend UI', () => {
    const selected = conversation('Statuses');
    const selectedMessages = (['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const).map(
      (status) => message(status, selected.id, { direction: 'OUTBOUND', status }),
    );
    const inbox = snapshot([selected], []);
    const markup = render(
      state({
        snapshot: inbox,
        visibleConversations: inbox.conversations,
        selectedConversationId: selected.id,
        selectedMessages,
      }),
    );

    for (const label of ['Sending…', 'Sent', 'Delivered', 'Read', 'Failed']) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain('Retry automatically');
    expect(markup).not.toContain('Resend automatically');
  });

  it('renders only active snapshot quick replies and selection only inserts text', () => {
    const controller = createController();
    const uiState = state({ composerText: 'Worker note' });
    const markup = render(uiState, controller);
    const tree = WhatsAppWorkspace({ controller, state: uiState });

    expect(markup).toContain('أوردر حضرتك جاهز.');
    expect(markup).not.toContain('Do not render');

    const reply = findElement(
      tree,
      (element) => element.props['data-quick-reply-id'] === 'active-reply',
    );
    (reply.props['onClick'] as () => void)();

    expect(controller.insertQuickReply).toHaveBeenCalledWith('أوردر حضرتك جاهز.');
    expect(controller.sendCurrentText).not.toHaveBeenCalled();
  });

  it('delegates composer changes and explicit Send, disabling Send for blank or busy composer', () => {
    const controller = createController();
    const uiState = state({ composerText: 'Send this' });
    const tree = WhatsAppWorkspace({ controller, state: uiState });

    const textarea = findElement(
      tree,
      (element) => element.props['data-whatsapp-composer'] === true,
    );
    (textarea.props['onChange'] as (event: { target: { value: string } }) => void)({
      target: { value: 'Edited text' },
    });
    const send = findElement(tree, (element) => element.props['data-whatsapp-send'] === true);
    (send.props['onClick'] as () => void)();

    expect(controller.setComposerText).toHaveBeenCalledWith('Edited text');
    expect(controller.sendCurrentText).toHaveBeenCalledTimes(1);

    const blankMarkup = render(state({ composerText: '   ' }));
    const busyMarkup = render(state({ composerText: 'ready', sendBusy: true }));
    expect(blankMarkup).toMatch(/data-whatsapp-send="true"[^>]*disabled=""/);
    expect(busyMarkup).toMatch(/data-whatsapp-send="true"[^>]*disabled=""/);
  });

  it('invokes explicit mark-unread, archive/unarchive, and follow-up controls', () => {
    const controller = createController();
    const uiState = state();
    const tree = WhatsAppWorkspace({ controller, state: uiState });

    for (const [action, invoke] of [
      ['mark-unread', () => expect(controller.markUnread).toHaveBeenCalledWith('Mona')],
      ['archive', () => expect(controller.setArchived).toHaveBeenCalledWith('Mona', true)],
      ['follow-up', () => expect(controller.setFollowUp).toHaveBeenCalledWith('Mona', false)],
    ] as const) {
      const button = findElement(
        tree,
        (element) => element.props['data-whatsapp-action'] === action,
      );
      (button.props['onClick'] as () => void)();
      invoke();
    }
  });

  it('shows network advisory and safe error text without any attachment/file/sendMedia affordance', () => {
    const markup = render(
      state({
        networkOffline: true,
        errorMessage: 'WhatsApp session needs attention.',
      }),
    );

    expect(markup).toContain(
      'Network offline — cached WhatsApp may be stale. POS continues normally.',
    );
    expect(markup).toContain('WhatsApp session needs attention.');
    expect(markup).not.toContain('type="file"');
    expect(markup.toLowerCase()).not.toContain('attachment');
    expect(markup).not.toContain('sendMedia');
    expect(markup.toLowerCase()).not.toContain('upload');
  });

  it('renders a compact customer/order context card with human order labels and explicit create/link actions', () => {
    const selected = conversation('مريم', {
      linkedOrderId: LINKED_ORDER_ID as WhatsAppConversation['linkedOrderId'],
    });
    const inbox = snapshot([selected], []);
    const markup = render(
      state({
        snapshot: inbox,
        visibleConversations: inbox.conversations,
        selectedConversationId: selected.id,
        customerOrderContext: {
          kind: 'ONE_ACTIVE_ORDER',
          customer: {
            normalizedPhone: selected.normalizedPhone,
            displayPhone: selected.displayPhone,
            customerName: 'مريم Hassan',
            address: 'Nasr City القاهرة',
            zoneId: null,
          },
          activeOrders: [
            {
              id: LINKED_ORDER_ID,
              displayOrderNo: 184,
              status: 'ACTIVE',
              orderTypeLabel: 'Delivery',
              createdAt: '2026-09-04T10:00:00.000Z' as Instant,
            },
          ],
        } as WhatsAppInboxUiState['customerOrderContext'],
      }),
    );

    expect(markup).toContain('data-whatsapp-region="customer-order-context"');
    expect(markup).toContain('Customer / Order');
    expect(markup).toContain('Order #184');
    expect(markup).toContain('Unlink');
    expect(markup).toContain('Create Order from Chat');
    expect(markup).toContain('dir="auto"');
    expect(markup).not.toContain(LINKED_ORDER_ID);
  });

  it('renders every multiple-order candidate explicitly and never promotes one to a primary selection', () => {
    const selected = conversation('Multiple');
    const inbox = snapshot([selected], []);
    const markup = render(
      state({
        snapshot: inbox,
        visibleConversations: inbox.conversations,
        selectedConversationId: selected.id,
        customerOrderContext: {
          kind: 'MULTIPLE_ACTIVE_ORDERS',
          customer: {
            normalizedPhone: selected.normalizedPhone,
            displayPhone: selected.displayPhone,
            customerName: 'Multiple',
            address: null,
            zoneId: null,
          },
          activeOrders: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrderId,
              displayOrderNo: 184,
              status: 'ACTIVE',
              orderTypeLabel: 'Delivery',
              createdAt: '2026-09-04T10:00:00.000Z' as Instant,
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as OrderId,
              displayOrderNo: 191,
              status: 'ACTIVE',
              orderTypeLabel: 'Delivery',
              createdAt: '2026-09-04T10:05:00.000Z' as Instant,
            },
          ],
        } as WhatsAppInboxUiState['customerOrderContext'],
      }),
    );

    expect(markup).toContain('Order #184');
    expect(markup).toContain('Order #191');
    expect(markup).toContain('Choose an order explicitly');
    expect(markup).not.toContain('data-whatsapp-primary-order="true"');
  });

  it('keeps Archive and Mark unread inside an accessible overflow while Follow-up remains secondary', () => {
    const controller = createController();
    const tree = WhatsAppWorkspace({ controller, state: state() });
    const markup = render(state(), controller);

    expect(markup).toContain('data-whatsapp-overflow="true"');
    expect(markup).toContain('aria-label="More conversation actions"');

    const overflow = findElement(
      tree,
      (element) => element.type === 'details' && element.props['data-whatsapp-overflow'] === true,
    );
    const archive = findElement(
      overflow.props['children'] as ReactNode,
      (element) => element.props['data-whatsapp-action'] === 'archive',
    );
    const markUnread = findElement(
      overflow.props['children'] as ReactNode,
      (element) => element.props['data-whatsapp-action'] === 'mark-unread',
    );
    expect(archive).toBeDefined();
    expect(markUnread).toBeDefined();
  });
});

describe('WhatsAppWorkspace Task 8E policy presentation', () => {
  it('keeps the normal sticky composer and Send Menu available in FREE_FORM mode', () => {
    const markup = render(
      state({
        messagingTarget: {
          mode: 'FREE_FORM',
          conversationId: 'Mona',
          freeFormUntil: '2026-09-05T10:00:00.000Z' as Instant,
          config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
        },
      } as Partial<WhatsAppInboxUiState>),
    );

    expect(markup).toContain('data-whatsapp-policy="FREE_FORM"');
    expect(markup).toContain('Send Menu');
    expect(markup).toContain('data-whatsapp-send="true"');
    expect(markup).not.toContain('No approved WhatsApp template');
  });

  it('preserves the draft, disables free-form send, and renders approved templates in TEMPLATE_ONLY mode', () => {
    const markup = render(
      state({
        composerText: 'draft must stay visible',
        messagingTarget: {
          mode: 'TEMPLATE_ONLY',
          conversationId: 'Mona',
          normalizedPhone: '+201012345678',
          displayPhone: '010 1234 5678',
          templates: [
            {
              id: 'starter-1',
              label: 'Start chat',
              languageCode: 'ar',
              previewText: 'أهلاً بحضرتك',
            },
          ],
          config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
        },
      } as Partial<WhatsAppInboxUiState>),
    );

    expect(markup).toContain('data-whatsapp-policy="TEMPLATE_ONLY"');
    expect(markup).toContain('draft must stay visible');
    expect(markup).toContain('Start chat');
    expect(markup).toContain('أهلاً بحضرتك');
    expect(markup).toContain('data-template-id="starter-1"');
    expect(markup).toContain('disabled=""');
  });

  it('keeps history visible and replaces outbound controls with an inline BLOCKED explanation', () => {
    const markup = render(
      state({
        messagingTarget: {
          mode: 'BLOCKED',
          conversationId: 'Mona',
          reason: 'NO_APPROVED_TEMPLATE',
          config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
        },
      } as Partial<WhatsAppInboxUiState>),
    );

    expect(markup).toContain('data-whatsapp-policy="BLOCKED"');
    expect(markup).toContain('data-whatsapp-region="message-history"');
    expect(markup).toContain('No approved WhatsApp template is available');
    expect(markup).not.toContain('data-whatsapp-send="true"');
  });
});
