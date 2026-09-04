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

describe('Task 9B inbound provider media fetch', () => {
  it('resolves Meta media metadata and downloads bytes server-side without returning the provider URL/id', async () => {
    const accessToken = 'server-media-secret';
    const providerDownloadUrl = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/private-media';
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/media-image')) {
        return new Response(
          JSON.stringify({
            id: 'media-image',
            url: providerDownloadUrl,
            mime_type: 'image/jpeg',
            sha256: 'provider-sha256',
            file_size: bytes.byteLength,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url === providerDownloadUrl) {
        expect(init?.headers).toMatchObject({ Authorization: `Bearer ${accessToken}` });
        return new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      }
      throw new Error(`unexpected provider request ${url}`);
    });
    const gateway = createWhatsAppProviderGateway(
      { graphVersion: 'v23.0', accessToken },
      fetchMock as unknown as typeof fetch,
    );
    const fetchMedia = Reflect.get(gateway, 'fetchMedia') as unknown;
    expect(fetchMedia).toEqual(expect.any(Function));

    const result = await (
      fetchMedia as (input: { providerMediaId: string }) => Promise<{
        mimeType: string;
        byteSize: number;
        sha256: string | null;
        body: ReadableStream<Uint8Array>;
      }>
    ).call(gateway, { providerMediaId: 'media-image' });

    expect(result).toMatchObject({
      mimeType: 'image/jpeg',
      byteSize: bytes.byteLength,
      sha256: 'provider-sha256',
    });
    expect(Object.keys(result).sort()).toEqual(['body', 'byteSize', 'mimeType', 'sha256'].sort());
    expect(JSON.stringify({ ...result, body: null })).not.toContain(providerDownloadUrl);
    expect(JSON.stringify({ ...result, body: null })).not.toContain('media-image');
    expect(JSON.stringify({ ...result, body: null })).not.toContain(accessToken);
    await expect(new Response(result.body).arrayBuffer()).resolves.toEqual(bytes.buffer);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://graph.facebook.com/v23.0/media-image',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Bearer ${accessToken}` }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps provider media download unavailability to a typed safe failure with no URL/token leak', async () => {
    const accessToken = 'never-leak-media-token';
    const providerDownloadUrl = 'https://lookaside.fbsbx.com/private-provider-download';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'media-doc',
            url: providerDownloadUrl,
            mime_type: 'application/pdf',
            sha256: 'provider-sha256',
            file_size: 123,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: providerDownloadUrl } }), { status: 503 }),
      );
    const gateway = createWhatsAppProviderGateway(
      { graphVersion: 'v23.0', accessToken },
      fetchMock as unknown as typeof fetch,
    );
    const fetchMedia = Reflect.get(gateway, 'fetchMedia') as unknown;
    expect(fetchMedia).toEqual(expect.any(Function));

    let thrown: unknown;
    try {
      await (
        fetchMedia as (input: { providerMediaId: string }) => Promise<unknown>
      ).call(gateway, { providerMediaId: 'media-doc' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WhatsAppProviderError);
    expect(thrown).toMatchObject({
      httpStatus: 503,
      safeMessage: 'WhatsApp provider media is unavailable.',
    });
    expect(String(thrown)).not.toContain(providerDownloadUrl);
    expect(String(thrown)).not.toContain(accessToken);
  });
});
