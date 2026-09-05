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
  type WhatsAppMediaDescriptor,
  type WhatsAppLocationPayload,
  type WhatsAppMessagingTarget,
  type WhatsAppShopMessagingConfig,
  type WhatsAppStarterTemplate,
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

function strictKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(source)) {
    if (!allowedSet.has(key)) throw new TypeError(`${label} contains an unsupported field.`);
  }
  for (const key of allowed) {
    if (!(key in source)) throw new TypeError(`${label} is missing ${key}.`);
  }
}

function finiteNumberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${label} must be finite.`);
  return value;
}

function parseMediaDescriptor(value: unknown): WhatsAppMediaDescriptor | null {
  if (value === null) return null;
  const source = object(value, 'WhatsApp media descriptor');
  strictKeys(
    source,
    [
      'mediaKey',
      'kind',
      'mimeType',
      'fileName',
      'byteSize',
      'storedAt',
      'expiresAt',
      'availability',
    ],
    'WhatsApp media descriptor',
  );
  return {
    mediaKey: requiredString(source['mediaKey'], 'WhatsApp media key'),
    kind: enumValue(source['kind'], ['IMAGE', 'DOCUMENT', 'AUDIO'] as const, 'WhatsApp media kind'),
    mimeType: requiredString(source['mimeType'], 'WhatsApp media mimeType'),
    fileName: nullableString(source['fileName'], 'WhatsApp media fileName'),
    byteSize: nonNegativeInteger(source['byteSize'], 'WhatsApp media byteSize'),
    storedAt: instant(requiredString(source['storedAt'], 'WhatsApp media storedAt')),
    expiresAt: instant(requiredString(source['expiresAt'], 'WhatsApp media expiresAt')),
    availability: enumValue(
      source['availability'],
      ['AVAILABLE', 'EXPIRED'] as const,
      'WhatsApp media availability',
    ),
  };
}

function parseLocationPayload(value: unknown): WhatsAppLocationPayload | null {
  if (value === null) return null;
  const source = object(value, 'WhatsApp location');
  strictKeys(source, ['latitude', 'longitude', 'name', 'address'], 'WhatsApp location');
  return {
    latitude: finiteNumberValue(source['latitude'], 'WhatsApp location latitude'),
    longitude: finiteNumberValue(source['longitude'], 'WhatsApp location longitude'),
    name: nullableString(source['name'], 'WhatsApp location name'),
    address: nullableString(source['address'], 'WhatsApp location address'),
  };
}

export function parseWhatsAppMessage(value: unknown): WhatsAppMessage {
  const source = object(value, 'WhatsApp message');
  strictKeys(
    source,
    [
      'id',
      'shopId',
      'conversationId',
      'providerMessageId',
      'outboundIntentKey',
      'direction',
      'kind',
      'text',
      'mediaRef',
      'media',
      'location',
      'status',
      'sentByWorkerId',
      'initiatedByDeviceId',
      'initiatedAt',
      'createdAt',
    ],
    'WhatsApp message',
  );
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
    media: parseMediaDescriptor(source['media']),
    location: parseLocationPayload(source['location']),
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

function exactKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(source).some((key) => !allowedSet.has(key))) {
    throw new TypeError(`${label} contains unsupported fields.`);
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function parseMessagingConfig(value: unknown): WhatsAppShopMessagingConfig {
  const source = object(value, 'WhatsApp messaging config');
  exactKeys(source, ['storefrontUrl', 'storeLocation'], 'WhatsApp messaging config');
  const storefrontUrl = requiredString(source['storefrontUrl'], 'WhatsApp storefrontUrl');
  let parsed: URL;
  try {
    parsed = new URL(storefrontUrl);
  } catch {
    throw new TypeError('WhatsApp storefrontUrl must be a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('WhatsApp storefrontUrl must be a valid HTTPS URL.');
  }
  if (source['storeLocation'] === null) return { storefrontUrl, storeLocation: null };

  const location = object(source['storeLocation'], 'WhatsApp store location');
  exactKeys(location, ['latitude', 'longitude', 'label', 'address'], 'WhatsApp store location');
  const latitude = finiteNumber(location['latitude'], 'WhatsApp store latitude');
  const longitude = finiteNumber(location['longitude'], 'WhatsApp store longitude');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new TypeError('WhatsApp store location is outside valid coordinate bounds.');
  }
  return {
    storefrontUrl,
    storeLocation: {
      latitude,
      longitude,
      label: nullableString(location['label'], 'WhatsApp store location label'),
      address: nullableString(location['address'], 'WhatsApp store location address'),
    },
  };
}

function parseStarterTemplate(value: unknown): WhatsAppStarterTemplate {
  const source = object(value, 'WhatsApp starter template');
  exactKeys(source, ['id', 'label', 'languageCode', 'previewText'], 'WhatsApp starter template');
  return {
    id: requiredString(source['id'], 'WhatsApp starter template id'),
    label: requiredString(source['label'], 'WhatsApp starter template label'),
    languageCode: requiredString(source['languageCode'], 'WhatsApp starter template languageCode'),
    previewText: requiredString(source['previewText'], 'WhatsApp starter template previewText'),
  };
}

export function parseWhatsAppMessagingTarget(value: unknown): WhatsAppMessagingTarget {
  const source = object(value, 'WhatsApp messaging target');
  const mode = enumValue(
    source['mode'],
    ['FREE_FORM', 'TEMPLATE_ONLY', 'BLOCKED'] as const,
    'WhatsApp messaging target mode',
  );
  if (mode === 'FREE_FORM') {
    exactKeys(
      source,
      ['mode', 'conversationId', 'freeFormUntil', 'config'],
      'WhatsApp FREE_FORM target',
    );
    return {
      mode,
      conversationId: requiredString(source['conversationId'], 'WhatsApp conversationId'),
      freeFormUntil: instant(requiredString(source['freeFormUntil'], 'WhatsApp freeFormUntil')),
      config: parseMessagingConfig(source['config']),
    };
  }
  if (mode === 'TEMPLATE_ONLY') {
    exactKeys(
      source,
      ['mode', 'conversationId', 'normalizedPhone', 'displayPhone', 'templates', 'config'],
      'WhatsApp TEMPLATE_ONLY target',
    );
    if (!Array.isArray(source['templates'])) {
      throw new TypeError('WhatsApp starter templates must be an array.');
    }
    return {
      mode,
      conversationId: nullableString(source['conversationId'], 'WhatsApp conversationId'),
      normalizedPhone: requiredString(source['normalizedPhone'], 'WhatsApp normalizedPhone'),
      displayPhone: requiredString(source['displayPhone'], 'WhatsApp displayPhone'),
      templates: source['templates'].map(parseStarterTemplate),
      config: parseMessagingConfig(source['config']),
    };
  }
  exactKeys(source, ['mode', 'conversationId', 'reason', 'config'], 'WhatsApp BLOCKED target');
  return {
    mode,
    conversationId: nullableString(source['conversationId'], 'WhatsApp conversationId'),
    reason: enumValue(
      source['reason'],
      ['NO_APPROVED_TEMPLATE'] as const,
      'WhatsApp blocked reason',
    ),
    config: parseMessagingConfig(source['config']),
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
  if (status === 409 && code === 'whatsapp_free_form_window_closed') {
    throw new WhatsAppRemoteError(
      'FREE_FORM_WINDOW_CLOSED',
      'The WhatsApp free-form messaging window has closed.',
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
