import { describe, expect, it } from 'vitest';
import { normalizeEgyptianPhone } from './phone';
import {
  assertWhatsAppMessageInvariant,
  type WhatsAppMessage,
} from './whatsapp';

const validOutbound: WhatsAppMessage = {
  id: 'message-1',
  shopId: '11111111-1111-4111-8111-111111111111' as WhatsAppMessage['shopId'],
  conversationId: 'conversation-1',
  providerMessageId: null,
  outboundIntentKey: 'whatsapp-send:conversation-1:intent-1',
  direction: 'OUTBOUND',
  kind: 'TEXT',
  text: 'تمام، أوردر حضرتك بيتجهز دلوقتي.',
  mediaRef: null,
  status: 'PENDING',
  sentByWorkerId: '22222222-2222-4222-8222-222222222222' as NonNullable<
    WhatsAppMessage['sentByWorkerId']
  >,
  initiatedByDeviceId: '33333333-3333-4333-8333-333333333333' as NonNullable<
    WhatsAppMessage['initiatedByDeviceId']
  >,
  initiatedAt: '2026-09-02T19:00:00.000Z' as NonNullable<WhatsAppMessage['initiatedAt']>,
  createdAt: '2026-09-02T19:00:00.000Z' as WhatsAppMessage['createdAt'],
};

describe('WhatsApp message invariants', () => {
  it('accepts an attributed outbound intent', () => {
    expect(() => assertWhatsAppMessageInvariant(validOutbound)).not.toThrow();
  });

  it('rejects an outbound message without a durable intent key', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({ ...validOutbound, outboundIntentKey: null }),
    ).toThrow('Outbound WhatsApp messages require a durable intent key.');
  });

  it('rejects outbound messages without current-worker attribution', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({ ...validOutbound, sentByWorkerId: null }),
    ).toThrow('Outbound WhatsApp messages require worker, device, and initiation attribution.');
  });

  it('rejects inbound messages carrying outbound attribution', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({
        ...validOutbound,
        direction: 'INBOUND',
        outboundIntentKey: null,
      }),
    ).toThrow('Inbound WhatsApp messages cannot carry outbound attribution.');
  });
});

describe('WhatsApp customer identity uses the shared Egyptian phone contract', () => {
  it.each([
    '01012345678',
    '+201012345678',
    '00201012345678',
    '201012345678',
    '1012345678',
  ])('maps %s to the same TUX customer key', (raw) => {
    const result = normalizeEgyptianPhone(raw);
    expect(result).toEqual({
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      valid: true,
    });
  });

  it('does not permit an unsupported international number to become a TUX customer key', () => {
    const result = normalizeEgyptianPhone('+491701234567');
    expect(result.valid).toBe(false);
  });
});
