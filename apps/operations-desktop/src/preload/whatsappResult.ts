import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  type ApplicationErrorCode,
} from '@tux/application';
import { instant, parseEntityId, type ShopId } from '@tux/domain';
import type { TuxWhatsAppApi } from '@tux/platform-contracts';

type InboxResult = Awaited<ReturnType<TuxWhatsAppApi['loadInbox']>>;
type ConversationResult = Awaited<ReturnType<TuxWhatsAppApi['loadConversation']>>;
type MessageResult = Awaited<ReturnType<TuxWhatsAppApi['sendText']>>;
type VoidResult = Awaited<ReturnType<TuxWhatsAppApi['markUnread']>>;
type DraftResult = Awaited<ReturnType<TuxWhatsAppApi['getDraft']>>;

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
