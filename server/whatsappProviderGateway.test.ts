import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppProviderError,
  createWhatsAppProviderGateway,
} from './whatsappProviderGateway';

describe('WhatsAppProviderGateway', () => {
  it('builds the Meta text-message request and formats the canonical Egyptian phone at the provider boundary', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const graphVersion = 'v23.0';
    const phoneNumberId = '123456789';
    const accessToken = 'super-secret-token';
    const gateway = createWhatsAppProviderGateway(
      { graphVersion, phoneNumberId, accessToken },
      fetchMock,
    );

    await expect(
      gateway.sendMessage({ to: '01012345678', kind: 'TEXT', text: 'Order ready' }),
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

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
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
    const fetchMock = vi.fn(async () =>
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
      { graphVersion: 'v23.0', phoneNumberId: '123456789', accessToken },
      fetchMock,
    );

    try {
      await gateway.sendMessage({ to: '+201012345678', kind: 'TEXT', text: 'Hello' });
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
});
