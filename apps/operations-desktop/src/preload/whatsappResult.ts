import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  type ApplicationErrorCode,
} from '@tux/application';
import {
  instant,
  parseEntityId,
  type DeliveryZoneId,
  type OrderId,
  type ShopId,
} from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';

type InboxResult = Awaited<ReturnType<TuxWhatsAppApi['loadInbox']>>;
type ConversationResult = Awaited<ReturnType<TuxWhatsAppApi['loadConversation']>>;
type MessageResult = Awaited<ReturnType<TuxWhatsAppApi['sendText']>>;
type VoidResult = Awaited<ReturnType<TuxWhatsAppApi['markUnread']>>;
type DraftResult = Awaited<ReturnType<TuxWhatsAppApi['getDraft']>>;
type CustomerOrderContextResult = Awaited<
  ReturnType<TuxWhatsAppApi['resolveCustomerOrderContext']>
>;
type MessagingTargetResult = Awaited<ReturnType<TuxWhatsAppApi['resolveMessagingTarget']>>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODES = new Set<ApplicationErrorCode>([
  'VALIDATION_ERROR',
  'INVALID_DRAFT',
  'LOCAL_PERSISTENCE_ERROR',
  'PRINT_ERROR',
  'REMOTE_SYNC_ERROR',
  'PIN_AUTH_ERROR',
  'CONFLICT_ERROR',
  'NOT_FOUND',
  'ALREADY_CLOSED',
  'IDEMPOTENCY_REPLAY',
  'WHATSAPP_FREE_FORM_WINDOW_CLOSED',
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('WhatsApp preload result must be an object.');
  }
  return value as Record<string, unknown>;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a UUID.`);
  }
  return value;
}

function safeError(value: unknown): { code: ApplicationErrorCode; message: string } {
  const source = record(value);
  const code = source['code'];
  if (
    typeof code !== 'string' ||
    !ERROR_CODES.has(code as ApplicationErrorCode) ||
    typeof source['message'] !== 'string'
  ) {
    throw new TypeError('Invalid WhatsApp application error from Electron main process.');
  }
  return { code: code as ApplicationErrorCode, message: source['message'] };
}

function parseMessage(value: unknown) {
  try {
    const parsed = parseWhatsAppMessage(value);
    uuid(parsed.conversationId, 'WhatsApp message conversationId');
    return parsed;
  } catch {
    throw new TypeError('Invalid WhatsApp message response from Electron main process.');
  }
}

function parseInbox(value: unknown) {
  try {
    const parsed = parseWhatsAppInboxSnapshot(value);
    for (const conversation of parsed.conversations) {
      uuid(conversation.id, 'WhatsApp conversation id');
    }
    for (const message of parsed.messages)
      uuid(message.conversationId, 'WhatsApp message conversationId');
    for (const link of parsed.orderLinks)
      uuid(link.conversationId, 'WhatsApp order-link conversationId');
    return parsed;
  } catch {
    throw new TypeError('Invalid WhatsApp inbox response from Electron main process.');
  }
}

function parseDraft(value: unknown) {
  try {
    const source = record(value);
    if (
      typeof source['shopId'] !== 'string' ||
      typeof source['text'] !== 'string' ||
      typeof source['updatedAt'] !== 'string'
    ) {
      throw new TypeError('Invalid WhatsApp draft fields.');
    }
    return {
      shopId: parseEntityId<ShopId>(source['shopId']),
      conversationId: uuid(source['conversationId'], 'WhatsApp draft conversationId'),
      text: source['text'],
      updatedAt: instant(source['updatedAt']),
    };
  } catch {
    throw new TypeError('Invalid WhatsApp draft response from Electron main process.');
  }
}

function exactKeys(source: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(source).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Invalid ${label} fields.`);
  }
}

function parseCustomerOrderContext(value: unknown) {
  const source = record(value);
  exactKeys(source, ['kind', 'customer', 'activeOrders'], 'WhatsApp customer-order context');
  const kind = source['kind'];
  if (
    kind !== 'NO_ACTIVE_ORDER' &&
    kind !== 'ONE_ACTIVE_ORDER' &&
    kind !== 'MULTIPLE_ACTIVE_ORDERS'
  ) {
    throw new TypeError('Invalid WhatsApp customer-order context kind.');
  }

  const customerSource = record(source['customer']);
  exactKeys(
    customerSource,
    ['normalizedPhone', 'displayPhone', 'customerName', 'address', 'zoneId'],
    'WhatsApp customer context',
  );
  if (
    typeof customerSource['normalizedPhone'] !== 'string' ||
    typeof customerSource['displayPhone'] !== 'string' ||
    typeof customerSource['customerName'] !== 'string' ||
    (customerSource['address'] !== null && typeof customerSource['address'] !== 'string') ||
    (customerSource['zoneId'] !== null && typeof customerSource['zoneId'] !== 'string')
  ) {
    throw new TypeError('Invalid WhatsApp customer context values.');
  }
  const customer = {
    normalizedPhone: customerSource['normalizedPhone'],
    displayPhone: customerSource['displayPhone'],
    customerName: customerSource['customerName'],
    address: customerSource['address'] as string | null,
    zoneId:
      customerSource['zoneId'] === null
        ? null
        : parseEntityId<DeliveryZoneId>(customerSource['zoneId']),
  };

  if (!Array.isArray(source['activeOrders'])) {
    throw new TypeError('WhatsApp active orders must be an array.');
  }
  const activeOrders = source['activeOrders'].map((value) => {
    const orderSource = record(value);
    exactKeys(
      orderSource,
      ['id', 'displayOrderNo', 'status', 'orderTypeLabel', 'createdAt'],
      'WhatsApp active-order summary',
    );
    if (
      typeof orderSource['id'] !== 'string' ||
      typeof orderSource['displayOrderNo'] !== 'number' ||
      !Number.isSafeInteger(orderSource['displayOrderNo']) ||
      orderSource['displayOrderNo'] <= 0 ||
      orderSource['status'] !== 'ACTIVE' ||
      typeof orderSource['orderTypeLabel'] !== 'string' ||
      typeof orderSource['createdAt'] !== 'string'
    ) {
      throw new TypeError('Invalid WhatsApp active-order summary values.');
    }
    return {
      id: parseEntityId<OrderId>(orderSource['id']),
      displayOrderNo: orderSource['displayOrderNo'],
      status: 'ACTIVE' as const,
      orderTypeLabel: orderSource['orderTypeLabel'],
      createdAt: instant(orderSource['createdAt']),
    };
  });

  if (
    (kind === 'NO_ACTIVE_ORDER' && activeOrders.length !== 0) ||
    (kind === 'ONE_ACTIVE_ORDER' && activeOrders.length !== 1) ||
    (kind === 'MULTIPLE_ACTIVE_ORDERS' && activeOrders.length < 2)
  ) {
    throw new TypeError('WhatsApp customer-order context cardinality does not match its kind.');
  }

  return { kind, customer, activeOrders };
}

function parseMessagingConfig(value: unknown) {
  const source = record(value);
  exactKeys(source, ['storefrontUrl', 'storeLocation'], 'WhatsApp messaging config');
  if (typeof source['storefrontUrl'] !== 'string') {
    throw new TypeError('Invalid WhatsApp storefront URL.');
  }
  let storefrontUrl: string;
  try {
    const url = new URL(source['storefrontUrl']);
    if (url.protocol !== 'https:') throw new TypeError('WhatsApp storefront URL must use HTTPS.');
    storefrontUrl = url.toString();
  } catch {
    throw new TypeError('Invalid WhatsApp storefront URL.');
  }

  if (source['storeLocation'] === null) return { storefrontUrl, storeLocation: null };
  const location = record(source['storeLocation']);
  exactKeys(location, ['latitude', 'longitude', 'label', 'address'], 'WhatsApp store location');
  if (
    typeof location['latitude'] !== 'number' ||
    !Number.isFinite(location['latitude']) ||
    location['latitude'] < -90 ||
    location['latitude'] > 90 ||
    typeof location['longitude'] !== 'number' ||
    !Number.isFinite(location['longitude']) ||
    location['longitude'] < -180 ||
    location['longitude'] > 180 ||
    (location['label'] !== null && typeof location['label'] !== 'string') ||
    (location['address'] !== null && typeof location['address'] !== 'string')
  ) {
    throw new TypeError('Invalid WhatsApp store location.');
  }
  return {
    storefrontUrl,
    storeLocation: {
      latitude: location['latitude'],
      longitude: location['longitude'],
      label: location['label'] as string | null,
      address: location['address'] as string | null,
    },
  };
}

function optionalConversationId(value: unknown): string | null {
  return value === null ? null : uuid(value, 'WhatsApp messaging target conversationId');
}

function parseMessagingTarget(value: unknown) {
  const source = record(value);
  const mode = source['mode'];
  if (mode === 'FREE_FORM') {
    exactKeys(
      source,
      ['mode', 'conversationId', 'freeFormUntil', 'config'],
      'WhatsApp FREE_FORM target',
    );
    if (typeof source['freeFormUntil'] !== 'string')
      throw new TypeError('Invalid free-form expiry.');
    return {
      mode,
      conversationId: uuid(source['conversationId'], 'WhatsApp messaging target conversationId'),
      freeFormUntil: instant(source['freeFormUntil']),
      config: parseMessagingConfig(source['config']),
    };
  }
  if (mode === 'TEMPLATE_ONLY') {
    exactKeys(
      source,
      ['mode', 'conversationId', 'normalizedPhone', 'displayPhone', 'templates', 'config'],
      'WhatsApp TEMPLATE_ONLY target',
    );
    if (
      typeof source['normalizedPhone'] !== 'string' ||
      source['normalizedPhone'].trim().length === 0 ||
      typeof source['displayPhone'] !== 'string' ||
      source['displayPhone'].trim().length === 0 ||
      !Array.isArray(source['templates'])
    ) {
      throw new TypeError('Invalid WhatsApp template target.');
    }
    const templates = source['templates'].map((value) => {
      const template = record(value);
      exactKeys(
        template,
        ['id', 'label', 'languageCode', 'previewText'],
        'WhatsApp starter template',
      );
      if (
        typeof template['id'] !== 'string' ||
        template['id'].trim().length === 0 ||
        typeof template['label'] !== 'string' ||
        template['label'].trim().length === 0 ||
        typeof template['languageCode'] !== 'string' ||
        template['languageCode'].trim().length === 0 ||
        typeof template['previewText'] !== 'string'
      )
        throw new TypeError('Invalid WhatsApp starter template.');
      return {
        id: template['id'],
        label: template['label'],
        languageCode: template['languageCode'],
        previewText: template['previewText'],
      };
    });
    return {
      mode,
      conversationId: optionalConversationId(source['conversationId']),
      normalizedPhone: source['normalizedPhone'],
      displayPhone: source['displayPhone'],
      templates,
      config: parseMessagingConfig(source['config']),
    };
  }
  if (mode === 'BLOCKED') {
    exactKeys(source, ['mode', 'conversationId', 'reason', 'config'], 'WhatsApp BLOCKED target');
    if (source['reason'] !== 'NO_APPROVED_TEMPLATE') {
      throw new TypeError('Invalid WhatsApp blocked reason.');
    }
    return {
      mode,
      conversationId: optionalConversationId(source['conversationId']),
      reason: 'NO_APPROVED_TEMPLATE' as const,
      config: parseMessagingConfig(source['config']),
    };
  }
  throw new TypeError('Invalid WhatsApp messaging target mode.');
}

function assertResult<Result>(
  value: unknown,
  label: string,
  parseSuccess: (payload: unknown) => unknown,
): Result {
  const source = record(value);
  if (typeof source['ok'] !== 'boolean') {
    throw new TypeError(`Invalid ${label} response from Electron main process.`);
  }
  if (source['ok'] === true) {
    return { ok: true, value: parseSuccess(source['value']) } as unknown as Result;
  }
  return { ok: false, error: safeError(source['error']) } as unknown as Result;
}

export function assertWhatsAppInboxResult(value: unknown): InboxResult {
  return assertResult<InboxResult>(value, 'WhatsApp inbox', parseInbox);
}

export function assertWhatsAppConversationResult(value: unknown): ConversationResult {
  return assertResult<ConversationResult>(value, 'WhatsApp conversation', (payload) => {
    if (!Array.isArray(payload)) throw new TypeError('WhatsApp conversation must be an array.');
    return payload.map(parseMessage);
  });
}

export function assertWhatsAppMessageResult(value: unknown): MessageResult {
  return assertResult<MessageResult>(value, 'WhatsApp message', parseMessage);
}

export function assertWhatsAppVoidResult(value: unknown): VoidResult {
  return assertResult<VoidResult>(value, 'WhatsApp mutation', (payload) => {
    if (payload !== undefined) throw new TypeError('WhatsApp mutation result must be void.');
    return undefined;
  });
}

export function assertWhatsAppDraftResult(value: unknown): DraftResult {
  return assertResult<DraftResult>(value, 'WhatsApp draft', (payload) =>
    payload === null ? null : parseDraft(payload),
  );
}

export function assertWhatsAppCustomerOrderContextResult(
  value: unknown,
): CustomerOrderContextResult {
  return assertResult<CustomerOrderContextResult>(
    value,
    'WhatsApp customer-order context',
    parseCustomerOrderContext,
  );
}

export function assertWhatsAppMessagingTargetResult(value: unknown): MessagingTargetResult {
  return assertResult<MessagingTargetResult>(
    value,
    'WhatsApp messaging target',
    parseMessagingTarget,
  );
}
