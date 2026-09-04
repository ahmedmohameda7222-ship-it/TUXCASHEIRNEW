import { describe, expect, it, vi } from 'vitest';
import { WhatsAppProviderError, createWhatsAppProviderGateway } from './whatsappProviderGateway';

describe('WhatsAppProviderGateway', () => {
  it('builds the Meta text-message request using the resolved provider phone identity', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const graphVersion = 'v23.0';
    const phoneNumberId = '123456789';
    const accessToken = 'super-secret-token';
    const gateway = createWhatsAppProviderGateway(
      { graphVersion, accessToken },
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      gateway.sendMessage({
        providerPhoneNumberId: phoneNumberId,
        to: '01012345678',
        kind: 'TEXT',
        text: 'Order ready',
      }),
    ).resolves.toEqual({ providerMessageId: 'wamid.outbound-1' });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        }),
      }),
    );

    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '201012345678',
      type: 'text',
      text: { body: 'Order ready' },
    });
  });

  it('returns a typed safe provider failure without leaking the access token', async () => {
    const accessToken = 'do-not-leak-this-token';
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              message: `provider diagnostic containing ${accessToken}`,
              code: 131026,
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
    );
    const gateway = createWhatsAppProviderGateway(
      { graphVersion: 'v23.0', accessToken },
      fetchMock as unknown as typeof fetch,
    );

    try {
      await gateway.sendMessage({
        providerPhoneNumberId: '123456789',
        to: '+201012345678',
        kind: 'TEXT',
        text: 'Hello',
      });
      throw new Error('expected provider send to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(WhatsAppProviderError);
      expect(error).toMatchObject({
        httpStatus: 400,
        providerCode: 131026,
        safeMessage: 'WhatsApp provider rejected the request.',
      });
      expect(String(error)).not.toContain(accessToken);
    }
  });

  it('rejects an invalid recipient before calling Meta', async () => {
    const fetchMock = vi.fn();
    const gateway = createWhatsAppProviderGateway(
      { graphVersion: 'v23.0', accessToken: 'test-token' },
      fetchMock as unknown as typeof fetch,
    );

    await expect(
      gateway.sendMessage({
        providerPhoneNumberId: '123456789',
        to: '+491701234567',
        kind: 'TEXT',
        text: 'Hello',
      }),
    ).rejects.toThrow('WhatsApp recipient phone is invalid.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Task 8D template provider payload', () => {
  it('builds a Meta template message only from server-owned template name and language', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.template-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const gateway = createWhatsAppProviderGateway(
      { graphVersion: 'v23.0', accessToken: 'server-secret' },
      fetchMock as unknown as typeof fetch,
    );
    const sendTemplate = gateway.sendMessage as unknown as (input: {
      providerPhoneNumberId: string;
      to: string;
      kind: 'TEMPLATE';
      providerTemplateName: string;
      languageCode: string;
    }) => Promise<{ providerMessageId: string }>;

    await expect(
      sendTemplate({
        providerPhoneNumberId: 'provider-phone-1',
        to: '01012345678',
        kind: 'TEMPLATE',
        providerTemplateName: 'tux_start',
        languageCode: 'ar',
      }),
    ).resolves.toEqual({ providerMessageId: 'wamid.template-1' });

    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '201012345678',
      type: 'template',
      template: {
        name: 'tux_start',
        language: { code: 'ar' },
      },
    });
  });
});
