import { createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { parseEntityId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { readRawBody } from '../api/whatsapp-webhook';
import { handleWhatsAppWebhook } from './whatsappWebhook';

const appSecret = 'test-app-secret';
const webhookVerifyToken = 'test-verify-token';
const shopId = parseEntityId<ShopId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

function signatureFor(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

function textPayload(
  sender = '201012345678',
  providerPhoneNumberId = 'provider-phone-1',
  messageId = 'wamid.test-1',
): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '201012345678',
                phone_number_id: providerPhoneNumberId,
              },
              contacts: [{ wa_id: sender, profile: { name: 'Ahmed' } }],
              messages: [
                {
                  from: sender,
                  id: messageId,
                  timestamp: '1788375600',
                  type: 'text',
                  text: { body: 'مساء الخير' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function dependencies(options?: { readonly knownChannel?: boolean }) {
  const events: string[] = [];
  const channelResolver = {
    resolveInboundChannel: vi.fn(async () => {
      events.push('resolve');
      if (options?.knownChannel === false) return null;
      return {
        channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        shopId,
      };
    }),
    resolveOutboundChannel: vi.fn(),
  };
  const materializer = {
    materializeInbound: vi.fn(async () => {
      events.push('materialize');
    }),
  };
  const diagnosticSink = vi.fn();
  return { channelResolver, materializer, diagnosticSink, events };
}

async function post(
  payload: Record<string, unknown>,
  deps: ReturnType<typeof dependencies>,
  signature?: string | null,
) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const headers: Record<string, string> = {};
  if (signature !== null) {
    headers['x-hub-signature-256'] = signature ?? signatureFor(rawBody);
  }
  return handleWhatsAppWebhook(
    {
      method: 'POST',
      url: 'https://tux.example/api/whatsapp-webhook',
      headers,
      rawBody,
    },
    {
      appSecret,
      webhookVerifyToken,
      channelResolver: deps.channelResolver,
      materializer: deps.materializer,
      diagnosticSink: deps.diagnosticSink,
    },
  );
}

describe('handleWhatsAppWebhook', () => {
  it('rejects a missing POST signature before tenant resolution or mutation', async () => {
    const deps = dependencies();

    const result = await post(textPayload(), deps, null);

    expect(result.status).toBe(401);
    expect(deps.channelResolver.resolveInboundChannel).not.toHaveBeenCalled();
    expect(deps.materializer.materializeInbound).not.toHaveBeenCalled();
  });

  it('rejects an invalid POST signature before JSON parsing, tenant resolution, or mutation', async () => {
    const deps = dependencies();
    const rawBody = Buffer.from('{not-json', 'utf8');

    const result = await handleWhatsAppWebhook(
      {
        method: 'POST',
        url: 'https://tux.example/api/whatsapp-webhook',
        headers: { 'x-hub-signature-256': 'sha256=00' },
        rawBody,
      },
      {
        appSecret,
        webhookVerifyToken,
        channelResolver: deps.channelResolver,
        materializer: deps.materializer,
        diagnosticSink: deps.diagnosticSink,
      },
    );

    expect(result.status).toBe(401);
    expect(deps.channelResolver.resolveInboundChannel).not.toHaveBeenCalled();
    expect(deps.materializer.materializeInbound).not.toHaveBeenCalled();
  });

  it('verifies the exact raw POST bytes rather than reconstructed JSON', async () => {
    const deps = dependencies();
    const rawBody = Buffer.from(JSON.stringify(textPayload(), null, 2), 'utf8');

    const result = await handleWhatsAppWebhook(
      {
        method: 'POST',
        url: 'https://tux.example/api/whatsapp-webhook',
        headers: { 'x-hub-signature-256': signatureFor(rawBody) },
        rawBody,
      },
      {
        appSecret,
        webhookVerifyToken,
        channelResolver: deps.channelResolver,
        materializer: deps.materializer,
        diagnosticSink: deps.diagnosticSink,
      },
    );

    expect(result.status).toBe(200);
    expect(deps.materializer.materializeInbound).toHaveBeenCalledTimes(1);
  });

  it('resolves metadata.phone_number_id before materializing with the resolved shop', async () => {
    const deps = dependencies();

    const result = await post(textPayload(), deps);

    expect(result.status).toBe(200);
    expect(deps.channelResolver.resolveInboundChannel).toHaveBeenCalledWith({
      provider: 'META_CLOUD_API',
      providerPhoneNumberId: 'provider-phone-1',
    });
    expect(deps.events).toEqual(['resolve', 'materialize']);
    expect(deps.materializer.materializeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        shopId,
        providerMessageId: 'wamid.test-1',
        normalizedPhone: '01012345678',
        displayPhone: '+201012345678',
        kind: 'TEXT',
        text: 'مساء الخير',
      }),
    );
  });

  it('acknowledges an unknown or inactive provider phone identity without selecting a tenant', async () => {
    const deps = dependencies({ knownChannel: false });

    const result = await post(textPayload(), deps);

    expect(result.status).toBe(200);
    expect(deps.channelResolver.resolveInboundChannel).toHaveBeenCalledTimes(1);
    expect(deps.materializer.materializeInbound).not.toHaveBeenCalled();
    expect(deps.diagnosticSink).toHaveBeenCalled();
  });

  it('never uses the sender/customer phone to choose the tenant', async () => {
    const deps = dependencies();

    await post(textPayload('201012345678'), deps);
    await post(textPayload('201112345678', 'provider-phone-1', 'wamid.test-2'), deps);

    expect(deps.channelResolver.resolveInboundChannel).toHaveBeenNthCalledWith(1, {
      provider: 'META_CLOUD_API',
      providerPhoneNumberId: 'provider-phone-1',
    });
    expect(deps.channelResolver.resolveInboundChannel).toHaveBeenNthCalledWith(2, {
      provider: 'META_CLOUD_API',
      providerPhoneNumberId: 'provider-phone-1',
    });
  });

  it('delegates duplicate provider-message idempotency to the Task 2 materializer', async () => {
    const deps = dependencies();
    const payload = textPayload();

    await post(payload, deps);
    await post(payload, deps);

    expect(deps.materializer.materializeInbound).toHaveBeenCalledTimes(2);
    expect(deps.materializer.materializeInbound).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ shopId, providerMessageId: 'wamid.test-1' }),
    );
    expect(deps.materializer.materializeInbound).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ shopId, providerMessageId: 'wamid.test-1' }),
    );
  });

  it('returns the Meta verification challenge only for the configured verify token', async () => {
    const deps = dependencies();
    const baseDependencies = {
      appSecret,
      webhookVerifyToken,
      channelResolver: deps.channelResolver,
      materializer: deps.materializer,
      diagnosticSink: deps.diagnosticSink,
    };

    const accepted = await handleWhatsAppWebhook(
      {
        method: 'GET',
        url: 'https://tux.example/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-123',
        headers: {},
        rawBody: Buffer.alloc(0),
      },
      baseDependencies,
    );
    const rejected = await handleWhatsAppWebhook(
      {
        method: 'GET',
        url: 'https://tux.example/api/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge-123',
        headers: {},
        rawBody: Buffer.alloc(0),
      },
      baseDependencies,
    );

    expect(accepted).toMatchObject({ status: 200, body: 'challenge-123' });
    expect(rejected.status).toBe(403);
    expect(deps.channelResolver.resolveInboundChannel).not.toHaveBeenCalled();
  });

  it.each([
    [
      'image',
      { id: 'media-image', mime_type: 'image/jpeg', sha256: 'image-sha', caption: 'receipt' },
      'IMAGE',
      'media-image',
      { mimeType: 'image/jpeg', sha256: 'image-sha', caption: 'receipt' },
    ],
    [
      'document',
      {
        id: 'media-doc',
        mime_type: 'application/pdf',
        sha256: 'doc-sha',
        filename: 'invoice.pdf',
        caption: 'invoice',
      },
      'DOCUMENT',
      'media-doc',
      {
        mimeType: 'application/pdf',
        sha256: 'doc-sha',
        filename: 'invoice.pdf',
        caption: 'invoice',
      },
    ],
    [
      'audio',
      { id: 'media-audio', mime_type: 'audio/ogg', sha256: 'audio-sha', voice: true },
      'AUDIO',
      'media-audio',
      { mimeType: 'audio/ogg', sha256: 'audio-sha', voice: true },
    ],
  ])(
    'translates verified %s metadata without downloading media',
    async (type, providerMedia, kind, mediaRef, mediaMetadata) => {
      const deps = dependencies();
      const payload = textPayload();
      const entry = (payload['entry'] as Array<Record<string, unknown>>)[0]!;
      const change = (entry['changes'] as Array<Record<string, unknown>>)[0]!;
      const value = change['value'] as Record<string, unknown>;
      const message = (value['messages'] as Array<Record<string, unknown>>)[0]!;
      delete message['text'];
      message['type'] = type;
      message[type] = providerMedia;

      const result = await post(payload, deps);

      expect(result.status).toBe(200);
      expect(deps.materializer.materializeInbound).toHaveBeenCalledWith(
        expect.objectContaining({ kind, mediaRef, mediaMetadata }),
      );
    },
  );

  it('persists location as contextual metadata rather than delivery-address truth', async () => {
    const deps = dependencies();
    const payload = textPayload();
    const entry = (payload['entry'] as Array<Record<string, unknown>>)[0]!;
    const change = (entry['changes'] as Array<Record<string, unknown>>)[0]!;
    const value = change['value'] as Record<string, unknown>;
    const message = (value['messages'] as Array<Record<string, unknown>>)[0]!;
    delete message['text'];
    message['type'] = 'location';
    message['location'] = {
      latitude: 30.0444,
      longitude: 31.2357,
      name: 'Tahrir Square',
      address: 'Cairo',
    };

    const result = await post(payload, deps);

    expect(result.status).toBe(200);
    expect(deps.materializer.materializeInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'LOCATION',
        mediaRef: null,
        mediaMetadata: {
          latitude: 30.0444,
          longitude: 31.2357,
          name: 'Tahrir Square',
          address: 'Cairo',
        },
      }),
    );
  });
});

describe('readRawBody', () => {
  it('preserves exact bytes up to the 1 MiB Vercel webhook limit', async () => {
    const bytes = Buffer.from(' { "raw": true }\n', 'utf8');
    const request = Readable.from([bytes]) as unknown as IncomingMessage;

    await expect(readRawBody(request)).resolves.toEqual(bytes);
  });

  it('rejects a POST body larger than 1 MiB', async () => {
    const request = Readable.from([Buffer.alloc(1_048_577)]) as unknown as IncomingMessage;

    await expect(readRawBody(request)).rejects.toThrow('WHATSAPP_WEBHOOK_BODY_TOO_LARGE');
  });
});
