import {
  assertWhatsAppMessageInvariant,
  instant,
  parseEntityId,
  type DeviceId,
  type OrderId,
  type ShopId,
  type WhatsAppConversation,
  type WhatsAppConversationContext,
  type WhatsAppMessage,
  type WhatsAppMessageDirection,
  type WhatsAppMessageKind,
  type WhatsAppMessageStatus,
  type WhatsAppQuickReply,
  type WhatsAppQuickReplyCategory,
  type WorkerId,
} from '@tux/domain';
import {
  WhatsAppRemoteError,
  type WhatsAppInboxOrderLink,
  type WhatsAppInboxSnapshot,
} from './whatsappRemote';

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} is required.`);
  }
  return value.trim();
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or null.`);
  return value;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as T;
}

function nullableInstant(value: unknown, label: string) {
  if (value === null) return null;
  return instant(requiredString(value, label));
}

export function parseWhatsAppMessage(value: unknown): WhatsAppMessage {
  const source = object(value, 'WhatsApp message');
  const message: WhatsAppMessage = {
    id: requiredString(source['id'], 'WhatsApp message id'),
    shopId: parseEntityId<ShopId>(requiredString(source['shopId'], 'WhatsApp message shopId')),
    conversationId: requiredString(source['conversationId'], 'WhatsApp message conversationId'),
    providerMessageId: nullableString(
      source['providerMessageId'],
      'WhatsApp message providerMessageId',
    ),
    outboundIntentKey: nullableString(
      source['outboundIntentKey'],
      'WhatsApp message outboundIntentKey',
    ),
    direction: enumValue<WhatsAppMessageDirection>(
      source['direction'],
      ['INBOUND', 'OUTBOUND'],
      'WhatsApp message direction',
    ),
    kind: enumValue<WhatsAppMessageKind>(
      source['kind'],
      ['TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION', 'SYSTEM'],
      'WhatsApp message kind',
    ),
    text: nullableString(source['text'], 'WhatsApp message text'),
    mediaRef: nullableString(source['mediaRef'], 'WhatsApp message mediaRef'),
    status: enumValue<WhatsAppMessageStatus>(
      source['status'],
      ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'],
      'WhatsApp message status',
    ),
    sentByWorkerId:
      source['sentByWorkerId'] === null
        ? null
        : parseEntityId<WorkerId>(
            requiredString(source['sentByWorkerId'], 'WhatsApp message sentByWorkerId'),
          ),
    initiatedByDeviceId:
      source['initiatedByDeviceId'] === null
        ? null
        : parseEntityId<DeviceId>(
            requiredString(source['initiatedByDeviceId'], 'WhatsApp message initiatedByDeviceId'),
          ),
    initiatedAt: nullableInstant(source['initiatedAt'], 'WhatsApp message initiatedAt'),
    createdAt: instant(requiredString(source['createdAt'], 'WhatsApp message createdAt')),
  };
  assertWhatsAppMessageInvariant(message);
  return message;
}

function parseConversation(value: unknown): WhatsAppConversation {
  const source = object(value, 'WhatsApp conversation');
  return {
    id: requiredString(source['id'], 'WhatsApp conversation id'),
    shopId: parseEntityId<ShopId>(requiredString(source['shopId'], 'WhatsApp conversation shopId')),
    normalizedPhone: requiredString(
      source['normalizedPhone'],
      'WhatsApp conversation normalizedPhone',
    ),
    displayPhone: requiredString(source['displayPhone'], 'WhatsApp conversation displayPhone'),
    customerName: nullableString(source['customerName'], 'WhatsApp conversation customerName'),
    context: enumValue<WhatsAppConversationContext>(
      source['context'],
      ['DIRECT', 'WEB_REQUEST', 'ORDER_LINKED'],
      'WhatsApp conversation context',
    ),
    linkedOrderId:
      source['linkedOrderId'] === null
        ? null
        : parseEntityId<OrderId>(
            requiredString(source['linkedOrderId'], 'WhatsApp conversation linkedOrderId'),
          ),
    unreadCount: nonNegativeInteger(source['unreadCount'], 'WhatsApp conversation unreadCount'),
    archived: requiredBoolean(source['archived'], 'WhatsApp conversation archived'),
    followUp: requiredBoolean(source['followUp'], 'WhatsApp conversation followUp'),
    lastMessageAt: nullableInstant(source['lastMessageAt'], 'WhatsApp conversation lastMessageAt'),
  };
}

function parseQuickReply(value: unknown): WhatsAppQuickReply {
  const source = object(value, 'WhatsApp quick reply');
  return {
    id: requiredString(source['id'], 'WhatsApp quick reply id'),
    shopId: parseEntityId<ShopId>(requiredString(source['shopId'], 'WhatsApp quick reply shopId')),
    category: enumValue<WhatsAppQuickReplyCategory>(
      source['category'],
      ['PREPARATION', 'DELIVERY', 'ADDRESS', 'PAYMENT', 'DELAY', 'THANKS'],
      'WhatsApp quick reply category',
    ),
    language: enumValue(
      source['language'],
      ['ar-EG', 'en'] as const,
      'WhatsApp quick reply language',
    ),
    text: requiredString(source['text'], 'WhatsApp quick reply text'),
    usageCount: nonNegativeInteger(source['usageCount'], 'WhatsApp quick reply usageCount'),
    active: requiredBoolean(source['active'], 'WhatsApp quick reply active'),
  };
}

function parseOrderLink(value: unknown): WhatsAppInboxOrderLink {
  const source = object(value, 'WhatsApp order link');
  return {
    conversationId: requiredString(source['conversationId'], 'WhatsApp order link conversationId'),
    orderId: parseEntityId<OrderId>(
      requiredString(source['orderId'], 'WhatsApp order link orderId'),
    ),
    linkedAt: instant(requiredString(source['linkedAt'], 'WhatsApp order link linkedAt')),
  };
}

export function parseWhatsAppInboxSnapshot(value: unknown): WhatsAppInboxSnapshot {
  const source = object(value, 'WhatsApp inbox response');
  if (
    !Array.isArray(source['conversations']) ||
    !Array.isArray(source['messages']) ||
    !Array.isArray(source['quickReplies']) ||
    !Array.isArray(source['orderLinks'])
  ) {
    throw new TypeError('WhatsApp inbox response is invalid.');
  }
  const nextCursor = source['nextCursor'];
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    throw new TypeError('WhatsApp inbox cursor is invalid.');
  }
  return {
    conversations: source['conversations'].map(parseConversation),
    messages: source['messages'].map(parseWhatsAppMessage),
    quickReplies: source['quickReplies'].map(parseQuickReply),
    orderLinks: source['orderLinks'].map(parseOrderLink),
    nextCursor,
  };
}

export function throwWhatsAppHttpError(status: number, payload: unknown): never {
  const source =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const code = typeof source['error'] === 'string' ? source['error'] : '';

  if (status === 409 && code === 'whatsapp_operator_not_synchronized') {
    throw new WhatsAppRemoteError(
      'OPERATOR_NOT_SYNCHRONIZED',
      'WhatsApp Current Operator is not synchronized.',
    );
  }
  if (status === 409 && code === 'whatsapp_outbound_intent_conflict') {
    throw new WhatsAppRemoteError(
      'OUTBOUND_INTENT_CONFLICT',
      'WhatsApp outbound intent conflicts with an existing message.',
    );
  }
  if (
    status === 503 &&
    code === 'whatsapp_delivery_uncertain' &&
    typeof source['messageId'] === 'string' &&
    source['messageId'].trim().length > 0
  ) {
    throw new WhatsAppRemoteError(
      'DELIVERY_UNCERTAIN',
      'WhatsApp delivery is not confirmed yet.',
      source['messageId'].trim(),
    );
  }
  if (
    status === 401 &&
    (code === 'device_authentication_required' ||
      code === 'device_session_invalid' ||
      code === 'device_authority_invalid')
  ) {
    throw new WhatsAppRemoteError(
      'DEVICE_AUTH_INVALID',
      'The enrolled Operations device session is no longer valid.',
    );
  }
  throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp request failed.');
}
