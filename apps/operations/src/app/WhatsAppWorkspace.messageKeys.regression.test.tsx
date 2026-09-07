import type { OrderId, WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppWorkspace, type WhatsAppWorkspaceController } from './WhatsAppWorkspace';
import type { WhatsAppInboxUiState } from './whatsappInboxController';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

function conversation(): WhatsAppConversation {
  return {
    id: CONVERSATION_ID,
    shopId: SHOP_ID,
    normalizedPhone: '01001234567',
    displayPhone: '+201001234567',
    customerName: 'Customer',
    context: 'DIRECT',
    linkedOrderId: null as OrderId | null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: '2026-09-08T00:00:00.000Z',
  } as WhatsAppConversation;
}

function message(id: string): WhatsAppMessage {
  return {
    id,
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
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
    createdAt: '2026-09-08T00:00:00.000Z',
  } as WhatsAppMessage;
}

function state(): WhatsAppInboxUiState {
  const selected = conversation();
  const messages = [message('message-1'), message('message-2')];
  const snapshot = {
    conversations: [selected],
    messages,
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };

  return {
    snapshot,
    visibleConversations: snapshot.conversations,
    selectedConversationId: selected.id,
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
    messagingTarget: null,
    contextBusy: false,
  } as WhatsAppInboxUiState;
}

function controller(): WhatsAppWorkspaceController {
  const noop = vi.fn();
  return new Proxy(
    {},
    {
      get: () => noop,
    },
  ) as WhatsAppWorkspaceController;
}

describe('WhatsAppWorkspace message keys regression', () => {
  it('renders multiple messages without React unique-key warnings', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      renderToStaticMarkup(<WhatsAppWorkspace controller={controller()} state={state()} />);

      const warnings = error.mock.calls.flat().map(String).join(' ');
      expect(warnings).not.toContain('Each child in a list should have a unique "key" prop');
    } finally {
      error.mockRestore();
    }
  });
});
