import { describe, expect, it } from 'vitest';
import { WhatsAppRemoteError } from './whatsappRemote';
import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  throwWhatsAppHttpError,
} from './whatsappWire';

const inboundMessage = {
  id: '50000000-0000-4000-8000-000000000001',
  shopId: '60000000-0000-4000-8000-000000000001',
  conversationId: '40000000-0000-4000-8000-000000000001',
  providerMessageId: 'wamid.1',
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
};

function capture(action: () => never): WhatsAppRemoteError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(WhatsAppRemoteError);
    return error as WhatsAppRemoteError;
  }
  throw new Error('Expected WhatsAppRemoteError.');
}

describe('WhatsApp wire codec', () => {
  it('parses durable message and inbox payloads with domain validation', () => {
    expect(parseWhatsAppMessage(inboundMessage)).toMatchObject({
      id: inboundMessage.id,
      text: 'hello',
    });
    expect(
      parseWhatsAppInboxSnapshot({
        conversations: [],
        messages: [inboundMessage],
        quickReplies: [],
        orderLinks: [],
        nextCursor: null,
      }).messages,
    ).toHaveLength(1);
  });

  it('rejects a malformed outbound message that violates the domain invariant', () => {
    expect(() =>
      parseWhatsAppMessage({
        ...inboundMessage,
        direction: 'OUTBOUND',
        providerMessageId: null,
        outboundIntentKey: null,
      }),
    ).toThrow();
  });

  it.each(['device_authentication_required', 'device_session_invalid', 'device_authority_invalid'])(
    'maps %s to DEVICE_AUTH_INVALID',
    (error) => {
      expect(capture(() => throwWhatsAppHttpError(401, { error }))).toMatchObject({
        code: 'DEVICE_AUTH_INVALID',
        messageId: null,
      });
    },
  );

  it('preserves Current Operator and outbound-intent conflict mappings', () => {
    expect(
      capture(() =>
        throwWhatsAppHttpError(409, {
          error: 'whatsapp_operator_not_synchronized',
        }),
      ),
    ).toMatchObject({ code: 'OPERATOR_NOT_SYNCHRONIZED', messageId: null });
    expect(
      capture(() =>
        throwWhatsAppHttpError(409, {
          error: 'whatsapp_outbound_intent_conflict',
        }),
      ),
    ).toMatchObject({ code: 'OUTBOUND_INTENT_CONFLICT', messageId: null });
  });

  it('preserves delivery uncertainty with only the durable message id', () => {
    const error = capture(() =>
      throwWhatsAppHttpError(503, {
        error: 'whatsapp_delivery_uncertain',
        messageId: inboundMessage.id,
        providerDiagnostic: 'hidden',
      }),
    );
    expect(error).toMatchObject({
      code: 'DELIVERY_UNCERTAIN',
      messageId: inboundMessage.id,
    });
    expect(error.message).not.toContain('hidden');
  });

  it('maps every other HTTP failure, including malformed error payloads, to REMOTE_UNAVAILABLE', () => {
    expect(capture(() => throwWhatsAppHttpError(500, { error: 'unexpected' }))).toMatchObject({
      code: 'REMOTE_UNAVAILABLE',
      messageId: null,
    });
    expect(capture(() => throwWhatsAppHttpError(401, 'invalid'))).toMatchObject({
      code: 'REMOTE_UNAVAILABLE',
      messageId: null,
    });
  });
});
