import type { WhatsAppConversation, WhatsAppMessage, WhatsAppQuickReply } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import {
  filterAndSortWhatsAppConversations,
  formatUnreadBadge,
  insertQuickReply,
  lastMessagePreview,
  sortActiveQuickReplies,
  totalUnreadCount,
  whatsAppConversationDisplayName,
  whatsAppConversationLabel,
  whatsAppMessageKindLabel,
  whatsAppStatusLabel,
} from './whatsappView';

function conversation(
  overrides: Partial<WhatsAppConversation> & Pick<WhatsAppConversation, 'id'>,
): WhatsAppConversation {
  const { id, ...rest } = overrides;
  return {
    id,
    shopId: '11111111-1111-4111-8111-111111111111',
    normalizedPhone: '+201000000000',
    displayPhone: '0100 000 0000',
    customerName: null,
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: null,
    ...rest,
  } as WhatsAppConversation;
}

function message(
  overrides: Partial<WhatsAppMessage> & Pick<WhatsAppMessage, 'id' | 'conversationId'>,
): WhatsAppMessage {
  const { id, conversationId, ...rest } = overrides;
  return {
    id,
    shopId: '11111111-1111-4111-8111-111111111111',
    conversationId,
    providerMessageId: null,
    outboundIntentKey: null,
    direction: 'INBOUND',
    kind: 'TEXT',
    text: 'hello',
    mediaRef: null,
    status: 'DELIVERED',
    sentByWorkerId: null,
    initiatedByDeviceId: null,
    initiatedAt: null,
    createdAt: '2026-09-03T12:00:00.000Z',
    ...rest,
  } as WhatsAppMessage;
}

function quickReply(
  overrides: Partial<WhatsAppQuickReply> & Pick<WhatsAppQuickReply, 'id' | 'category' | 'text'>,
): WhatsAppQuickReply {
  const { id, category, text, ...rest } = overrides;
  return {
    id,
    shopId: '11111111-1111-4111-8111-111111111111',
    category,
    language: 'ar-EG',
    text,
    usageCount: 0,
    active: true,
    ...rest,
  } as WhatsAppQuickReply;
}

const inboxConversations: readonly WhatsAppConversation[] = [
  conversation({
    id: 'null-last',
    customerName: 'Null Last',
    unreadCount: 3,
    lastMessageAt: null,
  }),
  conversation({
    id: 'older',
    customerName: 'Older',
    unreadCount: 120,
    followUp: true,
    lastMessageAt: '2026-09-03T09:00:00.000Z' as WhatsAppConversation['lastMessageAt'],
  }),
  conversation({
    id: 'newer',
    customerName: 'Newer',
    lastMessageAt: '2026-09-03T10:00:00.000Z' as WhatsAppConversation['lastMessageAt'],
  }),
  conversation({
    id: 'archived',
    customerName: 'Archived',
    archived: true,
    unreadCount: 77,
    lastMessageAt: '2026-09-03T11:00:00.000Z' as WhatsAppConversation['lastMessageAt'],
  }),
];

const searchConversations: readonly WhatsAppConversation[] = [
  conversation({
    id: 'customer-match',
    customerName: '  Ａｈｍｅｄ   Hassan  ',
    displayPhone: '0111 111 1111',
    normalizedPhone: '+201111111111',
  }),
  conversation({
    id: 'phone-match',
    customerName: 'Mona',
    displayPhone: '010 2222 3333',
    normalizedPhone: '+201022223333',
  }),
  conversation({
    id: 'message-match',
    customerName: 'Sara',
    displayPhone: '0122 222 2222',
    normalizedPhone: '+201222222222',
    linkedOrderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as WhatsAppConversation['linkedOrderId'],
  }),
];

const searchMessages: readonly WhatsAppMessage[] = [
  message({
    id: 'message-search-hit',
    conversationId: 'message-match',
    text: 'من فضلك   العنوان شارع النصر',
  }),
  message({
    id: 'unrelated',
    conversationId: 'outside-snapshot',
    text: 'ahmed 010 العنوان',
  }),
];

const quickReplies: readonly WhatsAppQuickReply[] = [
  quickReply({ id: 'thanks', category: 'THANKS', text: 'شكراً', usageCount: 50 }),
  quickReply({ id: 'prep-low', category: 'PREPARATION', text: 'جاهز قريباً', usageCount: 2 }),
  quickReply({ id: 'delivery', category: 'DELIVERY', text: 'في الطريق', usageCount: 30 }),
  quickReply({ id: 'address', category: 'ADDRESS', text: 'ابعت العنوان', usageCount: 20 }),
  quickReply({ id: 'payment', category: 'PAYMENT', text: 'تأكيد الدفع', usageCount: 10 }),
  quickReply({ id: 'delay', category: 'DELAY', text: 'في تأخير بسيط', usageCount: 5 }),
  quickReply({ id: 'prep-high', category: 'PREPARATION', text: 'بدأنا التحضير', usageCount: 8 }),
  quickReply({
    id: 'inactive-prep',
    category: 'PREPARATION',
    text: 'fallback must not appear',
    usageCount: 999,
    active: false,
  }),
];

describe('WhatsApp inbox view model', () => {
  it('filters ALL to non-archived conversations and sorts newest first deterministically', () => {
    const result = filterAndSortWhatsAppConversations(inboxConversations, [], 'ALL', '');
    expect(result.map((item) => item.id)).toEqual(['newer', 'older', 'null-last']);
  });

  it('supports UNREAD, FOLLOW_UP, and ARCHIVED exactly', () => {
    const unread = filterAndSortWhatsAppConversations(inboxConversations, [], 'UNREAD', '');
    const followUp = filterAndSortWhatsAppConversations(inboxConversations, [], 'FOLLOW_UP', '');
    const archived = filterAndSortWhatsAppConversations(inboxConversations, [], 'ARCHIVED', '');

    expect(unread.map((item) => item.id)).toEqual(['older', 'null-last']);
    expect(unread.every((item) => !item.archived && item.unreadCount > 0)).toBe(true);
    expect(followUp.map((item) => item.id)).toEqual(['older']);
    expect(followUp.every((item) => !item.archived && item.followUp)).toBe(true);
    expect(archived.map((item) => item.id)).toEqual(['archived']);
    expect(archived.every((item) => item.archived)).toBe(true);
  });

  it('uses display label and conversation ID tie-breaks rather than insertion order', () => {
    const timestamp = '2026-09-03T12:00:00.000Z' as WhatsAppConversation['lastMessageAt'];
    const fixtures = [
      conversation({ id: 'tie-b', customerName: 'Same', lastMessageAt: timestamp }),
      conversation({ id: 'label-z', customerName: 'Zulu', lastMessageAt: timestamp }),
      conversation({ id: 'tie-a', customerName: 'Same', lastMessageAt: timestamp }),
      conversation({ id: 'label-a', customerName: 'Alpha', lastMessageAt: timestamp }),
    ];

    const forward = filterAndSortWhatsAppConversations(fixtures, [], 'ALL', '').map(
      (item) => item.id,
    );
    const reversed = filterAndSortWhatsAppConversations([...fixtures].reverse(), [], 'ALL', '').map(
      (item) => item.id,
    );

    expect(forward).toEqual(['label-a', 'tie-a', 'tie-b', 'label-z']);
    expect(reversed).toEqual(forward);
  });

  it('searches normalized customer name, both phone forms, and loaded message text only', () => {
    expect(
      filterAndSortWhatsAppConversations(
        searchConversations,
        searchMessages,
        'ALL',
        '  AHMED ',
      ).map((item) => item.id),
    ).toEqual(['customer-match']);
    expect(
      filterAndSortWhatsAppConversations(searchConversations, searchMessages, 'ALL', '010').map(
        (item) => item.id,
      ),
    ).toEqual(['phone-match']);
    expect(
      filterAndSortWhatsAppConversations(
        searchConversations,
        searchMessages,
        'ALL',
        '20102222',
      ).map((item) => item.id),
    ).toEqual(['phone-match']);
    expect(
      filterAndSortWhatsAppConversations(searchConversations, searchMessages, 'ALL', 'العنوان').map(
        (item) => item.id,
      ),
    ).toEqual(['message-match']);
    expect(
      filterAndSortWhatsAppConversations(
        searchConversations,
        searchMessages,
        'ALL',
        'aaaaaaaa',
      ).map((item) => item.id),
    ).toEqual([]);
  });

  it.each([
    ['DIRECT', 'Direct WhatsApp'],
    ['WEB_REQUEST', 'Website Order Request'],
    ['ORDER_LINKED', 'Existing Order Chat'],
  ] as const)('maps %s context without inventing a human order number', (context, expected) => {
    const fixture = conversation({
      id: 'context',
      context,
      linkedOrderId:
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as WhatsAppConversation['linkedOrderId'],
    });
    expect(whatsAppConversationLabel(fixture)).toBe(expected);
    expect(whatsAppConversationLabel(fixture)).not.toContain('Order #');
    expect(whatsAppConversationLabel(fixture)).not.toContain('bbbbbbbb');
  });

  it('uses customer name first and display phone as the conversation display fallback', () => {
    expect(
      whatsAppConversationDisplayName(
        conversation({ id: 'named', customerName: 'Ahmed', displayPhone: '0100' }),
      ),
    ).toBe('Ahmed');
    expect(
      whatsAppConversationDisplayName(
        conversation({ id: 'phone', customerName: null, displayPhone: '0100 123 4567' }),
      ),
    ).toBe('0100 123 4567');
  });

  it('uses the latest loaded message for a deterministic preview and safe media labels', () => {
    const fixture = conversation({ id: 'preview' });
    const messages = [
      message({
        id: 'older-preview',
        conversationId: fixture.id,
        text: 'older',
        createdAt: '2026-09-03T10:00:00.000Z' as WhatsAppMessage['createdAt'],
      }),
      message({
        id: 'newer-preview',
        conversationId: fixture.id,
        kind: 'IMAGE',
        text: null,
        createdAt: '2026-09-03T11:00:00.000Z' as WhatsAppMessage['createdAt'],
      }),
      message({
        id: 'other-conversation',
        conversationId: 'other',
        text: 'must be ignored',
        createdAt: '2026-09-03T12:00:00.000Z' as WhatsAppMessage['createdAt'],
      }),
    ];

    expect(lastMessagePreview(fixture, messages)).toBe('Image message');
    expect(lastMessagePreview(conversation({ id: 'empty' }), messages)).toBe(null);
  });

  it('computes unread from non-archived conversations and caps badge presentation only', () => {
    expect(totalUnreadCount(inboxConversations)).toBe(123);
    expect(formatUnreadBadge(0)).toBe(null);
    expect(formatUnreadBadge(-1)).toBe(null);
    expect(formatUnreadBadge(12)).toBe('12');
    expect(formatUnreadBadge(99)).toBe('99');
    expect(formatUnreadBadge(100)).toBe('99+');
    expect(formatUnreadBadge(123)).toBe('99+');
  });

  it('uses only active snapshot quick replies and deterministic category/usage ordering', () => {
    const sorted = sortActiveQuickReplies(quickReplies);
    expect(sorted.every((reply) => reply.active)).toBe(true);
    expect(sorted.map((reply) => reply.category)).toEqual([
      'PREPARATION',
      'PREPARATION',
      'DELIVERY',
      'ADDRESS',
      'PAYMENT',
      'DELAY',
      'THANKS',
    ]);
    expect(sorted.slice(0, 2).map((reply) => reply.id)).toEqual(['prep-high', 'prep-low']);
  });

  it('uses deterministic text then ID tie-breaks for otherwise equal quick replies', () => {
    const fixtures = [
      quickReply({ id: 'z-id', category: 'DELIVERY', text: 'Beta', usageCount: 4 }),
      quickReply({ id: 'b-id', category: 'DELIVERY', text: 'Alpha', usageCount: 4 }),
      quickReply({ id: 'a-id', category: 'DELIVERY', text: 'Alpha', usageCount: 4 }),
    ];
    const forward = sortActiveQuickReplies(fixtures).map((reply) => reply.id);
    const reversed = sortActiveQuickReplies([...fixtures].reverse()).map((reply) => reply.id);
    expect(forward).toEqual(['a-id', 'b-id', 'z-id']);
    expect(reversed).toEqual(forward);
  });

  it('inserts a quick reply without clearing worker text and never sends by itself', () => {
    expect(insertQuickReply('', 'أوردر حضرتك جاهز.')).toBe('أوردر حضرتك جاهز.');
    expect(insertQuickReply('تمام', 'أوردر حضرتك جاهز.')).toBe('تمام\nأوردر حضرتك جاهز.');
  });

  it.each([
    ['IMAGE', 'Image message'],
    ['DOCUMENT', 'Document message'],
    ['AUDIO', 'Voice / audio message'],
    ['LOCATION', 'Location message'],
    ['SYSTEM', 'System update'],
  ] as const)('renders %s as a safe label', (kind, label) => {
    expect(whatsAppMessageKindLabel(kind)).toBe(label);
  });

  it.each([
    ['PENDING', 'Sending…'],
    ['SENT', 'Sent'],
    ['DELIVERED', 'Delivered'],
    ['READ', 'Read'],
    ['FAILED', 'Failed'],
  ] as const)('maps %s status deterministically', (status, label) => {
    expect(whatsAppStatusLabel(status)).toBe(label);
  });
});
