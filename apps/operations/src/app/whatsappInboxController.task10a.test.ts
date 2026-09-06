import type { WhatsAppInboxSnapshot } from '@tux/application';
import type { Instant, WhatsAppConversation, WhatsAppMessage } from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppInboxController,
  type WhatsAppInboxControllerEnvironment,
} from './whatsappInboxController';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';

function ok<T>(value: T) {
  return { ok: true, value } as const;
}

function conversation(): WhatsAppConversation {
  return {
    id: 'conversation-a',
    shopId: SHOP_ID,
    normalizedPhone: '+201012345678',
    displayPhone: '010 1234 5678',
    customerName: 'Mona',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 1,
    archived: false,
    followUp: false,
    lastMessageAt: '2026-09-06T02:00:00.000Z' as Instant,
  } as WhatsAppConversation;
}

function message(
  id: string,
  direction: WhatsAppMessage['direction'],
  text: string,
): WhatsAppMessage {
  return {
    id,
    shopId: SHOP_ID,
    conversationId: 'conversation-a',
    providerMessageId: null,
    outboundIntentKey: direction === 'OUTBOUND' ? `${id}-intent` : null,
    direction,
    kind: 'TEXT',
    text,
    mediaRef: null,
    media: null,
    location: null,
    status: direction === 'OUTBOUND' ? 'SENT' : 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-06T02:00:00.000Z' as Instant,
  } as WhatsAppMessage;
}

function snapshot(selected: WhatsAppConversation): WhatsAppInboxSnapshot {
  return {
    conversations: [selected],
    messages: [],
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

class Environment implements WhatsAppInboxControllerEnvironment {
  readonly nowMs = () => 1_000;
  readonly createIntentKey = () => 'intent-1';
  readonly setInterval = () => 1;
  readonly clearInterval = () => undefined;
  readonly setTimeout = () => 2;
  readonly clearTimeout = () => undefined;
  readonly isDocumentHidden = () => false;
  readonly isOnline = () => true;
  readonly addVisibilityListener = () => () => undefined;
  readonly addOnlineListener = () => () => undefined;
  readonly addOfflineListener = () => () => undefined;
}

describe('WhatsAppInboxController Task 10A selected conversation refresh', () => {
  it('reloads messages for the still-selected conversation after the inbox refreshes', async () => {
    const selected = conversation();
    const inbound = message('inbound-1', 'INBOUND', 'Can I order?');
    const outbound = message('outbound-1', 'OUTBOUND', 'Yes — what would you like?');
    const loadInbox = vi.fn<TuxWhatsAppApi['loadInbox']>().mockResolvedValue(ok(snapshot(selected)));
    const loadConversation = vi
      .fn<TuxWhatsAppApi['loadConversation']>()
      .mockResolvedValueOnce(ok([inbound]))
      .mockResolvedValue(ok([inbound, outbound]));
    const api = {
      loadInbox,
      loadConversation,
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
      resolveMessagingTarget: vi.fn().mockResolvedValue(
        ok({
          mode: 'FREE_FORM',
          conversationId: selected.id,
          freeFormUntil: '2026-09-06T03:00:00.000Z' as Instant,
          config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
        }),
      ),
    } as unknown as TuxWhatsAppApi;
    const controller = new WhatsAppInboxController(api, new Environment());

    await controller.refresh();
    expect(controller.getState().selectedMessages.map((item) => item.id)).toEqual(['inbound-1']);

    await controller.refresh();

    expect(loadConversation).toHaveBeenCalledTimes(2);
    expect(controller.getState().selectedConversationId).toBe(selected.id);
    expect(controller.getState().selectedMessages.map((item) => item.id)).toEqual([
      'inbound-1',
      'outbound-1',
    ]);
  });
});
