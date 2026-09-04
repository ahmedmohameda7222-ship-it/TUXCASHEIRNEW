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
  type WhatsAppShopMessagingConfig,
  type WhatsAppStarterTemplate,
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

export interface WhatsAppContactTarget {
  readonly conversationId: string;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
}

export interface WhatsAppMessagingPolicyRecord {
  readonly conversationId: string | null;
  readonly normalizedPhone: string | null;
  readonly displayPhone: string | null;
  readonly lastInboundAt: string | null;
  readonly freeFormUntil: string | null;
  readonly templates: readonly WhatsAppStarterTemplate[];
  readonly config: WhatsAppShopMessagingConfig;
}

export interface ClaimedWhatsAppTemplateIntent extends ClaimedWhatsAppOutboundIntent {
  readonly providerTemplateName: string;
  readonly languageCode: string;
}

export interface WhatsAppInboundMediaMaterializationInput {
  readonly shopId: ShopId;
  readonly providerMessageId: string;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly providerMediaId: string;
  readonly mediaKey: string;
  readonly bucketId: string;
  readonly objectPath: string;
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly sha256: string | null;
  readonly storedAt: string;
  readonly expiresAt: string;
  readonly providerOccurredAt: string | null;
}

export interface WhatsAppInboundMediaMaterializationResult {
  readonly messageId: string;
  readonly mediaKey: string;
  readonly created: boolean;
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

  materializeInboundMedia(
    input: WhatsAppInboundMediaMaterializationInput,
  ): Promise<WhatsAppInboundMediaMaterializationResult>;

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

  resolveContactTarget(input: {
    readonly shopId: ShopId;
    readonly normalizedPhone: string;
  }): Promise<WhatsAppContactTarget | null>;

  resolveMessagingPolicy(input: {
    readonly shopId: ShopId;
    readonly conversationId: string | null;
  }): Promise<WhatsAppMessagingPolicyRecord>;

  claimTemplateIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly normalizedPhone: string;
    readonly displayPhone: string;
    readonly templateId: string;
    readonly outboundIntentKey: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppTemplateIntent>;

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

function optionalNullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return stringValue(value);
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw protocolError();
  return value;
}

function parseMessagingConfig(source: UnknownRecord): WhatsAppShopMessagingConfig {
  const storefrontUrl = stringValue(source['storefront_url']);
  let url: URL;
  try {
    url = new URL(storefrontUrl);
  } catch {
    throw protocolError();
  }
  if (url.protocol !== 'https:') throw protocolError();

  const latitude = source['store_latitude'];
  const longitude = source['store_longitude'];
  const label = source['store_location_label'];
  const address = source['store_location_address'];
  if (latitude === null && longitude === null) {
    if (label !== null || address !== null) throw protocolError();
    return { storefrontUrl, storeLocation: null };
  }
  if (latitude === null || longitude === null) throw protocolError();
  const parsedLatitude = finiteNumber(latitude);
  const parsedLongitude = finiteNumber(longitude);
  if (
    parsedLatitude < -90 ||
    parsedLatitude > 90 ||
    parsedLongitude < -180 ||
    parsedLongitude > 180
  ) {
    throw protocolError();
  }
  return {
    storefrontUrl,
    storeLocation: {
      latitude: parsedLatitude,
      longitude: parsedLongitude,
      label: nullableString(label),
      address: nullableString(address),
    },
  };
}

function parseStarterTemplate(value: unknown): WhatsAppStarterTemplate {
  const source = record(value);
  return {
    id: arbitraryUuid(source['id']),
    label: stringValue(source['label']),
    languageCode: stringValue(source['languageCode']),
    previewText: stringValue(source['previewText']),
  };
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

function parseMedia(value: unknown): WhatsAppMessage['media'] {
  if (value === undefined || value === null) return null;
  const source = record(value);
  return {
    mediaKey: stringValue(source['mediaKey']),
    kind: enumValue(source['kind'], ['IMAGE', 'DOCUMENT', 'AUDIO'] as const),
    mimeType: stringValue(source['mimeType']),
    fileName: optionalNullableString(source['fileName']),
    byteSize: integerValue(source['byteSize']),
    storedAt: parseInstant(source['storedAt']),
    expiresAt: parseInstant(source['expiresAt']),
    availability: enumValue(source['availability'], ['AVAILABLE', 'EXPIRED'] as const),
  };
}

function parseLocation(value: unknown): WhatsAppMessage['location'] {
  if (value === undefined || value === null) return null;
  const source = record(value);
  const latitude = finiteNumber(source['latitude']);
  const longitude = finiteNumber(source['longitude']);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw protocolError();
  }
  return {
    latitude,
    longitude,
    name: optionalNullableString(source['name']),
    address: optionalNullableString(source['address']),
  };
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
    media: parseMedia(source['media']),
    location: parseLocation(source['location']),
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
      await this.#callRpc('get_tux_whatsapp_inbox_v2', {
        p_shop_id: input.shopId,
        p_cursor: input.after,
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

  async materializeInboundMedia(
    input: WhatsAppInboundMediaMaterializationInput,
  ): Promise<WhatsAppInboundMediaMaterializationResult> {
    const row = oneRow(
      await this.#callRpc('materialize_tux_whatsapp_inbound_v2', {
        p_shop_id: input.shopId,
        p_provider_message_id: input.providerMessageId,
        p_normalized_phone: input.normalizedPhone,
        p_display_phone: input.displayPhone,
        p_kind: input.kind,
        p_provider_media_id: input.providerMediaId,
        p_media_key: input.mediaKey,
        p_bucket_id: input.bucketId,
        p_object_path: input.objectPath,
        p_mime_type: input.mimeType,
        p_file_name: input.fileName,
        p_byte_size: input.byteSize,
        p_sha256: input.sha256,
        p_stored_at: input.storedAt,
        p_expires_at: input.expiresAt,
        p_provider_occurred_at: input.providerOccurredAt,
      }),
    );
    if (row === null) throw protocolError();
    const mediaKey = stringValue(row['media_key']);
    if (mediaKey !== input.mediaKey) throw protocolError();
    return {
      messageId: arbitraryUuid(row['message_id']),
      mediaKey,
      created: booleanValue(row['created']),
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

  async resolveContactTarget(input: {
    readonly shopId: ShopId;
    readonly normalizedPhone: string;
  }): Promise<WhatsAppContactTarget | null> {
    const row = oneRow(
      await this.#callRpc('get_tux_whatsapp_contact_target_v1', {
        p_shop_id: input.shopId,
        p_normalized_phone: input.normalizedPhone,
      }),
    );
    if (row === null) return null;
    return {
      conversationId: arbitraryUuid(row['conversation_id']),
      normalizedPhone: stringValue(row['normalized_phone']),
      displayPhone: stringValue(row['display_phone']),
    };
  }

  async resolveMessagingPolicy(input: {
    readonly shopId: ShopId;
    readonly conversationId: string | null;
  }): Promise<WhatsAppMessagingPolicyRecord> {
    const row = oneRow(
      await this.#callRpc('get_tux_whatsapp_messaging_policy_v1', {
        p_shop_id: input.shopId,
        p_conversation_id: input.conversationId,
      }),
    );
    if (row === null || !Array.isArray(row['templates_json'])) throw protocolError();
    return {
      conversationId:
        row['conversation_id'] === null ? null : arbitraryUuid(row['conversation_id']),
      normalizedPhone: nullableString(row['normalized_phone']),
      displayPhone: nullableString(row['display_phone']),
      lastInboundAt: row['last_inbound_at'] === null ? null : parseInstant(row['last_inbound_at']),
      freeFormUntil: row['free_form_until'] === null ? null : parseInstant(row['free_form_until']),
      templates: row['templates_json'].map(parseStarterTemplate),
      config: parseMessagingConfig(row),
    };
  }

  async claimTemplateIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly normalizedPhone: string;
    readonly displayPhone: string;
    readonly templateId: string;
    readonly outboundIntentKey: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppTemplateIntent> {
    const row = oneRow(
      await this.#callRpc('claim_tux_whatsapp_template_intent_v1', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
        p_device_id: input.deviceId,
        p_normalized_phone: input.normalizedPhone,
        p_display_phone: input.displayPhone,
        p_outbound_intent_key: input.outboundIntentKey,
        p_template_id: input.templateId,
        p_initiated_at: input.initiatedAt,
      }),
    );
    if (row === null) throw protocolError();
    const parsed = parseMessage(row['message_json']);
    return {
      created: booleanValue(row['created']),
      recipientNormalizedPhone: stringValue(row['recipient_normalized_phone']),
      providerTemplateName: stringValue(row['provider_template_name']),
      languageCode: stringValue(row['language_code']),
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
