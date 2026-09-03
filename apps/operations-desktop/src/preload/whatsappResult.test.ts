import { describe, expect, it } from 'vitest';
import {
  assertWhatsAppConversationResult,
  assertWhatsAppDraftResult,
  assertWhatsAppInboxResult,
  assertWhatsAppMessageResult,
  assertWhatsAppVoidResult,
} from './whatsappResult';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const WORKER_ID = '44444444-4444-4444-8444-444444444444';
const DEVICE_ID = '55555555-5555-4555-8555-555555555555';

function message() {
  return {
    id: 'provider-message-1',
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
    providerMessageId: 'wamid.1',
    outboundIntentKey: null,
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text: 'hello',
    mediaRef: null,
    status: 'SENT',
    sentByWorkerId: WORKER_ID,
    initiatedByDeviceId: DEVICE_ID,
    initiatedAt: '2026-09-03T12:00:00.000Z',
    createdAt: '2026-09-03T12:00:00.000Z',
  };
}

function inbox() {
  return {
    conversations: [],
    messages: [message()],
    quickReplies: [],
    orderLinks: [
      {
        conversationId: CONVERSATION_ID,
        orderId: ORDER_ID,
        linkedAt: '2026-09-03T12:00:00.000Z',
      },
    ],
    nextCursor: null,
  };
}

function draft() {
  return {
    shopId: SHOP_ID,
    conversationId: CONVERSATION_ID,
    text: 'draft text',
    updatedAt: '2026-09-03T12:00:00.000Z',
  };
}

describe('WhatsApp preload result parsing', () => {
  it('accepts valid success payloads for every public result shape', () => {
    expect(assertWhatsAppInboxResult({ ok: true, value: inbox() })).toMatchObject({ ok: true });
    expect(assertWhatsAppConversationResult({ ok: true, value: [message()] })).toMatchObject({
      ok: true,
    });
    expect(assertWhatsAppMessageResult({ ok: true, value: message() })).toMatchObject({ ok: true });
    expect(assertWhatsAppVoidResult({ ok: true, value: undefined })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(assertWhatsAppDraftResult({ ok: true, value: draft() })).toMatchObject({ ok: true });
    expect(assertWhatsAppDraftResult({ ok: true, value: null })).toEqual({ ok: true, value: null });
  });

  it('rejects non-object Result values', () => {
    for (const value of [null, undefined, 'result', 1, []]) {
      expect(() => assertWhatsAppInboxResult(value)).toThrow(TypeError);
    }
  });

  it('rejects malformed success payloads', () => {
    expect(() => assertWhatsAppInboxResult({ ok: true, value: { ...inbox(), messages: [{}] } })).toThrow(
      TypeError,
    );
    expect(() => assertWhatsAppConversationResult({ ok: true, value: [null] })).toThrow(TypeError);
    expect(() => assertWhatsAppMessageResult({ ok: true, value: { ...message(), shopId: 'forged' } })).toThrow(
      TypeError,
    );
    expect(() => assertWhatsAppVoidResult({ ok: true, value: 'not-void' })).toThrow(TypeError);
    expect(() => assertWhatsAppDraftResult({ ok: true, value: { ...draft(), shopId: 'forged' } })).toThrow(
      TypeError,
    );
  });

  it('rejects forged nested order identifiers', () => {
    const malformed = inbox();
    malformed.orderLinks = [{ ...malformed.orderLinks[0]!, orderId: 'forged-order-id' }];
    expect(() => assertWhatsAppInboxResult({ ok: true, value: malformed })).toThrow(TypeError);
  });

  it('rejects unknown application error codes and non-string messages', () => {
    expect(() =>
      assertWhatsAppMessageResult({
        ok: false,
        error: { code: 'MADE_UP', message: 'x' },
      }),
    ).toThrow(TypeError);
    expect(() =>
      assertWhatsAppMessageResult({
        ok: false,
        error: { code: 'REMOTE_SYNC_ERROR', message: 123 },
      }),
    ).toThrow(TypeError);
  });

  it('accepts every current application error code and strips untrusted cause', () => {
    for (const code of [
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
    ] as const) {
      expect(
        assertWhatsAppMessageResult({
          ok: false,
          error: { code, message: 'safe', cause: { secret: 'must-not-cross-preload' } },
        }),
      ).toEqual({ ok: false, error: { code, message: 'safe' } });
    }
  });
});
