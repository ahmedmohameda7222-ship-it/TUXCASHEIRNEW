import type {
  WhatsAppConversation,
  WhatsAppConversationContext,
  WhatsAppMessage,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
  WhatsAppQuickReply,
  WhatsAppQuickReplyCategory,
} from '@tux/domain';

export type WhatsAppInboxFilter = 'ALL' | 'UNREAD' | 'FOLLOW_UP' | 'ARCHIVED';

const QUICK_REPLY_CATEGORY_ORDER: readonly WhatsAppQuickReplyCategory[] = [
  'PREPARATION',
  'DELIVERY',
  'ADDRESS',
  'PAYMENT',
  'DELAY',
  'THANKS',
];

const QUICK_REPLY_CATEGORY_INDEX = new Map(
  QUICK_REPLY_CATEGORY_ORDER.map((category, index) => [category, index] as const),
);

function normalizeSearchValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function matchesFilter(conversation: WhatsAppConversation, filter: WhatsAppInboxFilter): boolean {
  switch (filter) {
    case 'ALL':
      return conversation.archived === false;
    case 'UNREAD':
      return conversation.archived === false && conversation.unreadCount > 0;
    case 'FOLLOW_UP':
      return conversation.archived === false && conversation.followUp === true;
    case 'ARCHIVED':
      return conversation.archived === true;
  }
}

function compareConversations(a: WhatsAppConversation, b: WhatsAppConversation): number {
  if (a.lastMessageAt === null && b.lastMessageAt !== null) return 1;
  if (a.lastMessageAt !== null && b.lastMessageAt === null) return -1;

  if (a.lastMessageAt !== null && b.lastMessageAt !== null) {
    const byLastMessage = String(b.lastMessageAt).localeCompare(String(a.lastMessageAt));
    if (byLastMessage !== 0) return byLastMessage;
  }

  const byDisplayName = whatsAppConversationDisplayName(a).localeCompare(
    whatsAppConversationDisplayName(b),
  );
  if (byDisplayName !== 0) return byDisplayName;

  return a.id.localeCompare(b.id);
}

function conversationMatchesSearch(
  conversation: WhatsAppConversation,
  messages: readonly WhatsAppMessage[],
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;

  const directValues = [
    conversation.customerName ?? '',
    conversation.displayPhone,
    conversation.normalizedPhone,
  ];
  if (directValues.some((value) => normalizeSearchValue(value).includes(normalizedQuery))) {
    return true;
  }

  return messages.some(
    (message) =>
      message.conversationId === conversation.id &&
      message.text !== null &&
      normalizeSearchValue(message.text).includes(normalizedQuery),
  );
}

export function filterAndSortWhatsAppConversations(
  conversations: readonly WhatsAppConversation[],
  messages: readonly WhatsAppMessage[],
  filter: WhatsAppInboxFilter,
  search: string,
): WhatsAppConversation[] {
  const normalizedQuery = normalizeSearchValue(search);
  return conversations
    .filter((conversation) => matchesFilter(conversation, filter))
    .filter((conversation) => conversationMatchesSearch(conversation, messages, normalizedQuery))
    .sort(compareConversations);
}

export function whatsAppConversationLabel(conversation: WhatsAppConversation): string {
  const labels: Record<WhatsAppConversationContext, string> = {
    DIRECT: 'Direct WhatsApp',
    WEB_REQUEST: 'Website Order Request',
    ORDER_LINKED: 'Existing Order Chat',
  };
  return labels[conversation.context];
}

export function whatsAppConversationDisplayName(conversation: WhatsAppConversation): string {
  const customerName = conversation.customerName?.trim();
  return customerName && customerName.length > 0 ? customerName : conversation.displayPhone;
}

export function whatsAppMessageKindLabel(kind: WhatsAppMessageKind): string {
  const labels: Record<WhatsAppMessageKind, string> = {
    TEXT: 'Text message',
    IMAGE: 'Image message',
    DOCUMENT: 'Document message',
    AUDIO: 'Voice / audio message',
    LOCATION: 'Location message',
    SYSTEM: 'System update',
  };
  return labels[kind];
}

export function lastMessagePreview(
  conversation: WhatsAppConversation,
  messages: readonly WhatsAppMessage[],
): string | null {
  const latest = messages
    .filter((message) => message.conversationId === conversation.id)
    .slice()
    .sort((a, b) => {
      const byCreatedAt = String(b.createdAt).localeCompare(String(a.createdAt));
      return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
    })[0];

  if (!latest) return null;
  if (latest.kind === 'TEXT' && latest.text !== null) return latest.text;
  return whatsAppMessageKindLabel(latest.kind);
}

export function sortActiveQuickReplies(
  quickReplies: readonly WhatsAppQuickReply[],
): WhatsAppQuickReply[] {
  return quickReplies
    .filter((reply) => reply.active === true)
    .slice()
    .sort((a, b) => {
      const byCategory =
        (QUICK_REPLY_CATEGORY_INDEX.get(a.category) ?? Number.MAX_SAFE_INTEGER) -
        (QUICK_REPLY_CATEGORY_INDEX.get(b.category) ?? Number.MAX_SAFE_INTEGER);
      if (byCategory !== 0) return byCategory;

      const byUsage = b.usageCount - a.usageCount;
      if (byUsage !== 0) return byUsage;

      const byText = a.text.localeCompare(b.text);
      return byText !== 0 ? byText : a.id.localeCompare(b.id);
    });
}

export function insertQuickReply(current: string, reply: string): string {
  return current.length === 0 ? reply : `${current}\n${reply}`;
}

export function whatsAppStatusLabel(status: WhatsAppMessageStatus): string {
  const labels: Record<WhatsAppMessageStatus, string> = {
    PENDING: 'Sending…',
    SENT: 'Sent',
    DELIVERED: 'Delivered',
    READ: 'Read',
    FAILED: 'Failed',
  };
  return labels[status];
}

export function totalUnreadCount(conversations: readonly WhatsAppConversation[]): number {
  return conversations.reduce(
    (total, conversation) => total + (conversation.archived ? 0 : conversation.unreadCount),
    0,
  );
}

export function formatUnreadBadge(totalUnread: number): string | null {
  if (totalUnread <= 0) return null;
  return totalUnread >= 100 ? '99+' : String(totalUnread);
}
