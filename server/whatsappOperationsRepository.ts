import type { WhatsAppInboxOrderLink, WhatsAppInboxSnapshot } from '@tux/application';
import {
  assertWhatsAppMessageInvariant,
  instant,
  parseEntityId,
  type BusinessDayId,
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
import type { WhatsAppDataServerConfig } from './whatsappServerConfig';

export type WhatsAppOperationsRepositoryErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'REMOTE_UNAVAILABLE'
  | 'REMOTE_REJECTED'
  | 'PROTOCOL_ERROR';

export class WhatsAppOperationsRepositoryError extends Error {
  readonly code: WhatsAppOperationsRepositoryErrorCode;

  constructor(code: WhatsAppOperationsRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'WhatsAppOperationsRepositoryError';
    this.code = code;
  }
}

export interface ClaimedWhatsAppOutboundIntent {
  readonly created: boolean;
  readonly recipientNormalizedPhone: string;
  readonly message: WhatsAppMessage;
}

export interface WhatsAppOperationsRepository {
  resolveCurrentOperator(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
  }): Promise<{ readonly businessDayId: BusinessDayId; readonly workerId: WorkerId } | null>;

  loadInbox(input: {
    readonly shopId: ShopId;
    readonly after: string | null;
  }): Promise<WhatsAppInboxSnapshot>;

  claimOutboundTextIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent>;

  attachProviderMessage(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly providerMessageId: string;
  }): Promise<void>;

  failOutboundIntent(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): Promise<void>;

  setConversationState(input: {
    readonly shopId: ShopId;
    readonly conversationId: string;
    readonly archived: boolean | null;
    readonly followUp: boolean | null;
    readonly markUnread: boolean;
  }): Promise<void>;

  linkOrderAuthorized(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked: boolean;
  }): Promise<void>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function protocolError(): WhatsAppOperationsRepositoryError {
  return new WhatsAppOperationsRepositoryError(
    'PROTOCOL_ERROR',
    'WhatsApp remote returned an invalid response.',
  );
}

function record(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw protocolError();
  return value as UnknownRecord;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw protocolError();
  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return stringValue(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw protocolError();
  return value;
}

function integerValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw protocolError();
  return value;
}

function id<Id extends ShopId | BusinessDayId | WorkerId | DeviceId | OrderId>(value: unknown): Id {
  try {
    return parseEntityId<Id>(stringValue(value));
  } catch {
    throw protocolError();
  }
}

function arbitraryUuid(value: unknown): string {
  try {
    return parseEntityId(stringValue(value));
  } catch {
    throw protocolError();
  }
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  const parsed = stringValue(value);
  if (!allowed.includes(parsed as T)) throw protocolError();
  return parsed as T;
}

function parseInstant(value: unknown): ReturnType<typeof instant> {
  try {
    return instant(stringValue(value));
  } catch {
    throw protocolError();
  }
}

function parseNullableInstant(value: unknown): ReturnType<typeof instant> | null {
  return value === null ? null : parseInstant(value);
}

function parseMessage(value: unknown): {
  readonly message: WhatsAppMessage;
  readonly updatedAt: string;
} {
  const source = record(value);
  const message: WhatsAppMessage = {
    id: arbitraryUuid(source['id']),
    shopId: id<ShopId>(source['shop_id']),
    conversationId: arbitraryUuid(source['conversation_id']),
    providerMessageId: nullableString(source['provider_message_id']),
    outboundIntentKey: nullableString(source['outbound_intent_key']),
    direction: enumValue<WhatsAppMessageDirection>(source['direction'], ['INBOUND', 'OUTBOUND']),
    kind: enumValue<WhatsAppMessageKind>(source['kind'], [
      'TEXT',
      'IMAGE',
      'DOCUMENT',
      'AUDIO',
      'LOCATION',
      'SYSTEM',
    ]),
    text: nullableString(source['text']),
    mediaRef: nullableString(source['media_ref']),
    status: enumValue<WhatsAppMessageStatus>(source['status'], [
      'PENDING',
      'SENT',
      'DELIVERED',
      'READ',
      'FAILED',
    ]),
    sentByWorkerId:
      source['sent_by_worker_id'] === null ? null : id<WorkerId>(source['sent_by_worker_id']),
    initiatedByDeviceId:
      source['initiated_by_device_id'] === null
        ? null
        : id<DeviceId>(source['initiated_by_device_id']),
    initiatedAt: parseNullableInstant(source['initiated_at']),
    createdAt: parseInstant(source['created_at']),
  };

  try {
    assertWhatsAppMessageInvariant(message);
  } catch {
    throw protocolError();
  }

  return { message, updatedAt: parseInstant(source['updated_at']) };
}

function parseOrderLink(value: unknown): WhatsAppInboxOrderLink {
  const source = record(value);
  return {
    conversationId: arbitraryUuid(source['conversation_id']),
    orderId: id<OrderId>(source['order_id']),
    linkedAt: parseInstant(source['linked_at']),
  };
}

function parseConversation(
  value: unknown,
  linkedOrders: ReadonlyMap<string, readonly OrderId[]>,
): WhatsAppConversation {
  const source = record(value);
  const conversationId = arbitraryUuid(source['id']);
  const orders = linkedOrders.get(conversationId) ?? [];
  return {
    id: conversationId,
    shopId: id<ShopId>(source['shop_id']),
    normalizedPhone: stringValue(source['normalized_phone']),
    displayPhone: stringValue(source['display_phone']),
    customerName: nullableString(source['customer_name']),
    context: enumValue<WhatsAppConversationContext>(source['context'], [
      'DIRECT',
      'WEB_REQUEST',
      'ORDER_LINKED',
    ]),
    linkedOrderId: orders.length === 1 ? (orders[0] ?? null) : null,
    unreadCount: integerValue(source['unread_count']),
    archived: booleanValue(source['archived']),
    followUp: booleanValue(source['follow_up']),
    lastMessageAt: parseNullableInstant(source['last_message_at']),
  };
}

function parseQuickReply(value: unknown): WhatsAppQuickReply {
  const source = record(value);
  return {
    id: arbitraryUuid(source['id']),
    shopId: id<ShopId>(source['shop_id']),
    category: enumValue<WhatsAppQuickReplyCategory>(source['category'], [
      'PREPARATION',
      'DELIVERY',
      'ADDRESS',
      'PAYMENT',
      'DELAY',
      'THANKS',
    ]),
    language: enumValue(source['language'], ['ar-EG', 'en'] as const),
    text: stringValue(source['text']),
    usageCount: integerValue(source['usage_count']),
    active: booleanValue(source['active']),
  };
}

function oneRow(value: unknown): UnknownRecord | null {
  if (!Array.isArray(value)) throw protocolError();
  if (value.length === 0) return null;
  if (value.length !== 1) throw protocolError();
  return record(value[0]);
}

export class SupabaseWhatsAppOperationsRepository implements WhatsAppOperationsRepository {
  readonly #config: WhatsAppDataServerConfig;
  readonly #fetch: typeof fetch;

  constructor(config: WhatsAppDataServerConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async #callRpc(functionName: string, body: UnknownRecord): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.projectUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: this.#config.serviceRoleKey,
          Authorization: `Bearer ${this.#config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new WhatsAppOperationsRepositoryError(
        'REMOTE_UNAVAILABLE',
        'WhatsApp remote is unavailable.',
      );
    }

    const raw = await response.text().catch(() => {
      throw protocolError();
    });
    let payload: unknown = null;
    if (raw.length > 0) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw protocolError();
      }
    }

    if (!response.ok) {
      let remoteMessage: string | null = null;
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        const candidate = (payload as UnknownRecord)['message'];
        remoteMessage = typeof candidate === 'string' ? candidate : null;
      }
      if (remoteMessage === 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED') {
        throw new WhatsAppOperationsRepositoryError(
          'OPERATOR_NOT_SYNCHRONIZED',
          'WhatsApp Current Operator is not synchronized.',
        );
      }
      if (remoteMessage === 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT') {
        throw new WhatsAppOperationsRepositoryError(
          'OUTBOUND_INTENT_CONFLICT',
          'WhatsApp outbound intent conflicts with an existing durable intent.',
        );
      }
      throw new WhatsAppOperationsRepositoryError(
        'REMOTE_REJECTED',
        'WhatsApp remote rejected the request.',
      );
    }

    return payload;
  }

  async resolveCurrentOperator(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
  }): Promise<{ readonly businessDayId: BusinessDayId; readonly workerId: WorkerId } | null> {
    const row = oneRow(
      await this.#callRpc('resolve_tux_whatsapp_current_operator_v1', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
      }),
    );
    if (row === null) return null;
    return {
      businessDayId: id<BusinessDayId>(row['business_day_id']),
      workerId: id<WorkerId>(row['worker_id']),
    };
  }

  async loadInbox(input: {
    readonly shopId: ShopId;
    readonly after: string | null;
  }): Promise<WhatsAppInboxSnapshot> {
    const source = record(
      await this.#callRpc('get_tux_whatsapp_inbox_v1', {
        p_shop_id: input.shopId,
        p_after: input.after,
      }),
    );
    if (
      !Array.isArray(source['conversations']) ||
      !Array.isArray(source['messages']) ||
      !Array.isArray(source['quickReplies']) ||
      !Array.isArray(source['orderLinks'])
    ) {
      throw protocolError();
    }

    const orderLinks = source['orderLinks'].map(parseOrderLink);
    const linkedOrders = new Map<string, OrderId[]>();
    for (const link of orderLinks) {
      const existing = linkedOrders.get(link.conversationId) ?? [];
      existing.push(link.orderId);
      linkedOrders.set(link.conversationId, existing);
    }

    const parsedMessages = source['messages'].map(parseMessage);
    let nextCursor = input.after;
    for (const parsed of parsedMessages) {
      if (nextCursor === null || parsed.updatedAt > nextCursor) nextCursor = parsed.updatedAt;
    }

    return {
      conversations: source['conversations'].map((value) => parseConversation(value, linkedOrders)),
      messages: parsedMessages.map(({ message }) => message),
      quickReplies: source['quickReplies'].map(parseQuickReply),
      orderLinks,
      nextCursor,
    };
  }

  async claimOutboundTextIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent> {
    const row = oneRow(
      await this.#callRpc('claim_tux_whatsapp_outbound_intent_v2', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
        p_device_id: input.deviceId,
        p_conversation_id: input.conversationId,
        p_outbound_intent_key: input.outboundIntentKey,
        p_kind: 'TEXT',
        p_text: input.text,
        p_media_ref: null,
        p_media_metadata: {},
        p_initiated_at: input.initiatedAt,
      }),
    );
    if (row === null) throw protocolError();
    const parsed = parseMessage(row['message_json']);
    return {
      created: booleanValue(row['created']),
      recipientNormalizedPhone: stringValue(row['recipient_normalized_phone']),
      message: parsed.message,
    };
  }

  async attachProviderMessage(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly providerMessageId: string;
  }): Promise<void> {
    await this.#callRpc('attach_tux_whatsapp_provider_message_v1', {
      p_shop_id: input.shopId,
      p_message_id: input.messageId,
      p_provider_message_id: input.providerMessageId,
      p_status: 'SENT',
    });
  }

  async failOutboundIntent(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): Promise<void> {
    await this.#callRpc('fail_tux_whatsapp_outbound_intent_v1', {
      p_shop_id: input.shopId,
      p_message_id: input.messageId,
      p_failure_code: input.failureCode,
      p_failure_message: input.failureMessage,
    });
  }

  async setConversationState(input: {
    readonly shopId: ShopId;
    readonly conversationId: string;
    readonly archived: boolean | null;
    readonly followUp: boolean | null;
    readonly markUnread: boolean;
  }): Promise<void> {
    await this.#callRpc('set_tux_whatsapp_conversation_state_v1', {
      p_shop_id: input.shopId,
      p_conversation_id: input.conversationId,
      p_archived: input.archived,
      p_follow_up: input.followUp,
      p_mark_unread: input.markUnread,
    });
  }

  async linkOrderAuthorized(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked: boolean;
  }): Promise<void> {
    await this.#callRpc('link_tux_whatsapp_conversation_order_authorized_v1', {
      p_shop_id: input.shopId,
      p_business_day_id: input.businessDayId,
      p_claimed_worker_id: input.workerId,
      p_device_id: input.deviceId,
      p_conversation_id: input.conversationId,
      p_order_id: input.orderId,
      p_linked: input.linked,
    });
  }
}
