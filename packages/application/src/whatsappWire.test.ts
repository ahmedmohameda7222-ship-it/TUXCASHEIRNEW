import { describe, expect, it } from 'vitest';
import { WhatsAppRemoteError } from './whatsappRemote';
import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  parseWhatsAppMessagingTarget,
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

  it('parses only the safe server-authoritative messaging target shape', () => {
    const config = {
      storefrontUrl: 'https://menu.tux.example',
      storeLocation: {
        latitude: 30.0444,
        longitude: 31.2357,
        label: 'TUX',
        address: 'Cairo',
      },
    };
    expect(
      parseWhatsAppMessagingTarget({
        mode: 'FREE_FORM',
        conversationId: '40000000-0000-4000-8000-000000000001',
        freeFormUntil: '2026-09-05T12:00:00.000Z',
        config,
      }),
    ).toMatchObject({ mode: 'FREE_FORM', config });
    expect(
      parseWhatsAppMessagingTarget({
        mode: 'TEMPLATE_ONLY',
        conversationId: null,
        normalizedPhone: '+201001234567',
        displayPhone: '01001234567',
        templates: [
          {
            id: '70000000-0000-4000-8000-000000000001',
            label: 'Start chat',
            languageCode: 'ar',
            previewText: 'أهلاً بحضرتك',
          },
        ],
        config,
      }),
    ).toMatchObject({ mode: 'TEMPLATE_ONLY', templates: [{ label: 'Start chat' }] });
    expect(
      parseWhatsAppMessagingTarget({
        mode: 'BLOCKED',
        conversationId: null,
        reason: 'NO_APPROVED_TEMPLATE',
        config,
      }),
    ).toMatchObject({ mode: 'BLOCKED', reason: 'NO_APPROVED_TEMPLATE' });
  });

  it('rejects provider, secret, signed-url, and unknown target fields instead of forwarding them', () => {
    const base = {
      mode: 'TEMPLATE_ONLY',
      conversationId: null,
      normalizedPhone: '+201001234567',
      displayPhone: '01001234567',
      templates: [
        {
          id: '70000000-0000-4000-8000-000000000001',
          label: 'Start chat',
          languageCode: 'ar',
          previewText: 'أهلاً بحضرتك',
        },
      ],
      config: { storefrontUrl: 'https://menu.tux.example', storeLocation: null },
    };
    expect(() =>
      parseWhatsAppMessagingTarget({ ...base, providerPhoneNumberId: 'secret' }),
    ).toThrow();
    expect(() =>
      parseWhatsAppMessagingTarget({
        ...base,
        templates: [{ ...base.templates[0], providerTemplateName: 'secret_name' }],
      }),
    ).toThrow();
    expect(() =>
      parseWhatsAppMessagingTarget({
        ...base,
        config: { ...base.config, signedUrl: 'https://storage.example/token' },
      }),
    ).toThrow();
  });

  it('maps the server free-form-window race to a dedicated safe remote error', () => {
    expect(
      capture(() =>
        throwWhatsAppHttpError(409, {
          error: 'whatsapp_free_form_window_closed',
          providerDiagnostic: 'hidden',
        }),
      ),
    ).toMatchObject({ code: 'FREE_FORM_WINDOW_CLOSED', messageId: null });
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
