import type {
  WhatsAppInboxOrderLink,
  WhatsAppInboxSnapshot,
  WhatsAppRemoteGateway,
} from '@tux/application';
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

export class WhatsAppOperatorNotSynchronizedError extends Error {
  constructor() {
    super('WhatsApp Current Operator is not synchronized.');
    this.name = 'WhatsAppOperatorNotSynchronizedError';
  }
}

export class WhatsAppOutboundIntentConflictError extends Error {
  constructor() {
    super('WhatsApp outbound intent conflicts with an existing message.');
    this.name = 'WhatsAppOutboundIntentConflictError';
  }
}

export class WhatsAppDeliveryUncertainError extends Error {
  readonly messageId: string;

  constructor(messageId: string) {
    super('WhatsApp delivery is not confirmed yet.');
    this.name = 'WhatsAppDeliveryUncertainError';
    this.messageId = messageId;
  }
}

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

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value as T;
}

function nullableInstant(value: unknown, label: string) {
  if (value === null) return null;
  return instant(requiredString(value, label));
}

function parseMessage(value: unknown): WhatsAppMessage {
  const source = object(value, 'WhatsApp message');
  const message: WhatsAppMessage = {
    id: requiredString(source['id'], 'WhatsApp message id'),
    shopId: parseEntityId<ShopId>(requiredString(source['shopId'], 'WhatsApp message shopId')),
    conversationId: requiredString(
      source['conversationId'],
      'WhatsApp message conversationId',
    ),
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
            requiredString(
              source['initiatedByDeviceId'],
              'WhatsApp message initiatedByDeviceId',
            ),
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
    shopId: parseEntityId<ShopId>(
      requiredString(source['shopId'], 'WhatsApp conversation shopId'),
    ),
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
    lastMessageAt: nullableInstant(
      source['lastMessageAt'],
      'WhatsApp conversation lastMessageAt',
    ),
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
    language: enumValue(source['language'], ['ar-EG', 'en'] as const, 'WhatsApp quick reply language'),
    text: requiredString(source['text'], 'WhatsApp quick reply text'),
    usageCount: nonNegativeInteger(source['usageCount'], 'WhatsApp quick reply usageCount'),
    active: requiredBoolean(source['active'], 'WhatsApp quick reply active'),
  };
}

function parseOrderLink(value: unknown): WhatsAppInboxOrderLink {
  const source = object(value, 'WhatsApp order link');
  return {
    conversationId: requiredString(source['conversationId'], 'WhatsApp order link conversationId'),
    orderId: parseEntityId<OrderId>(requiredString(source['orderId'], 'WhatsApp order link orderId')),
    linkedAt: instant(requiredString(source['linkedAt'], 'WhatsApp order link linkedAt')),
  };
}

function parseSnapshot(value: Record<string, unknown>): WhatsAppInboxSnapshot {
  if (
    !Array.isArray(value['conversations']) ||
    !Array.isArray(value['messages']) ||
    !Array.isArray(value['quickReplies']) ||
    !Array.isArray(value['orderLinks'])
  ) {
    throw new TypeError('WhatsApp inbox response is invalid.');
  }
  const nextCursor = value['nextCursor'];
  if (nextCursor !== null && typeof nextCursor !== 'string') {
    throw new TypeError('WhatsApp inbox cursor is invalid.');
  }
  return {
    conversations: value['conversations'].map(parseConversation),
    messages: value['messages'].map(parseMessage),
    quickReplies: value['quickReplies'].map(parseQuickReply),
    orderLinks: value['orderLinks'].map(parseOrderLink),
    nextCursor,
  };
}

function mapRemoteError(status: number, payload: Record<string, unknown>): never {
  const code = typeof payload['error'] === 'string' ? payload['error'] : '';
  if (status === 409 && code === 'whatsapp_operator_not_synchronized') {
    throw new WhatsAppOperatorNotSynchronizedError();
  }
  if (status === 409 && code === 'whatsapp_outbound_intent_conflict') {
    throw new WhatsAppOutboundIntentConflictError();
  }
  if (status === 503 && code === 'whatsapp_delivery_uncertain') {
    const messageId = requiredString(payload['messageId'], 'WhatsApp uncertain message id');
    throw new WhatsAppDeliveryUncertainError(messageId);
  }
  throw new Error('WhatsApp request failed.');
}

async function requestJson(
  method: 'GET' | 'POST',
  url: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers:
        body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('WhatsApp remote is unavailable.');
  }

  let payload: Record<string, unknown>;
  try {
    payload = object(await response.json(), 'WhatsApp remote response');
  } catch {
    throw new Error('WhatsApp remote returned an invalid response.');
  }

  if (!response.ok) mapRemoteError(response.status, payload);
  return payload;
}

async function mutate(body: Readonly<Record<string, unknown>>): Promise<void> {
  await requestJson('POST', '/api/whatsapp', body);
}

export class VercelBrowserWhatsAppRemote implements WhatsAppRemoteGateway {
  async loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot> {
    const url =
      cursor === undefined ? '/api/whatsapp' : `/api/whatsapp?after=${encodeURIComponent(cursor)}`;
    return parseSnapshot(await requestJson('GET', url));
  }

  async sendText(input: Parameters<WhatsAppRemoteGateway['sendText']>[0]): Promise<WhatsAppMessage> {
    const payload = await requestJson('POST', '/api/whatsapp', {
      action: 'SEND_MESSAGE',
      businessDayId: input.businessDayId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      outboundIntentKey: input.outboundIntentKey,
      text: input.text,
    });
    return parseMessage(payload['message']);
  }

  async markUnread(conversationId: string): Promise<void> {
    await mutate({ action: 'MARK_UNREAD', conversationId });
  }

  async archive(conversationId: string, archived = true): Promise<void> {
    await mutate({ action: 'ARCHIVE', conversationId, archived });
  }

  async setFollowUp(conversationId: string, followUp: boolean): Promise<void> {
    await mutate({ action: 'FOLLOW_UP', conversationId, followUp });
  }

  async linkOrder(input: Parameters<WhatsAppRemoteGateway['linkOrder']>[0]): Promise<void> {
    await mutate({
      action: 'LINK_ORDER',
      businessDayId: input.businessDayId,
      workerId: input.workerId,
      conversationId: input.conversationId,
      orderId: input.orderId,
      linked: input.linked ?? true,
    });
  }
}
