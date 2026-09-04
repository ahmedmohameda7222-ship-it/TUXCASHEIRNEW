import { createHash, createHmac } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { parseEntityId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { readRawBody } from '../api/whatsapp-webhook';
import { WhatsAppProviderError } from './whatsappProviderGateway';
import {
  handleWhatsAppWebhook,
  type WhatsAppInboundMediaStoreResult,
} from './whatsappWebhook';

const appSecret = 'test-app-secret';
const webhookVerifyToken = 'test-verify-token';
const shopId = parseEntityId<ShopId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const storedAt = '2026-09-04T12:00:00.000Z';
const expiresAt = '2026-10-04T12:00:00.000Z';

function signatureFor(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

function inboundMediaKey(providerMessageId: string): string {
  return createHash('sha256').update(`inbound:${shopId}:${providerMessageId}`).digest('hex');
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

function binaryPayload(input: {
  readonly type: 'image' | 'document' | 'audio';
  readonly providerMediaId: string;
  readonly messageId?: string;
  readonly mimeType?: string;
  readonly fileName?: string;
}): Record<string, unknown> {
  const payload = textPayload(
    '201012345678',
    'provider-phone-1',
    input.messageId ?? 'wamid.media-1',
  );
  const entry = (payload['entry'] as Array<Record<string, unknown>>)[0]!;
  const change = (entry['changes'] as Array<Record<string, unknown>>)[0]!;
  const value = change['value'] as Record<string, unknown>;
  const message = (value['messages'] as Array<Record<string, unknown>>)[0]!;
  delete message['text'];
  message['type'] = input.type;
  message[input.type] = {
    id: input.providerMediaId,
    ...(input.mimeType ? { mime_type: input.mimeType } : {}),
    ...(input.fileName ? { filename: input.fileName } : {}),
  };
  return payload;
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
    materializeInboundMedia: vi.fn(async (_input: Record<string, unknown>) => {
      events.push('materialize-media');
    }),
  };
  const providerGateway = {
    sendMessage: vi.fn(),
    fetchMedia: vi.fn(async () => {
      events.push('fetch-media');
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
      return {
        mimeType: 'image/jpeg',
        byteSize: bytes.byteLength,
        sha256: 'provider-sha256',
        body: new Response(bytes).body!,
      };
    }),
  };
  const mediaStore = {
    storeInboundMedia: vi.fn(
      async (input: Record<string, unknown>): Promise<WhatsAppInboundMediaStoreResult> => {
        events.push('store-media');
        const mediaKey = inboundMediaKey(String(input['providerMessageId']));
        return {
          status: 'STORED',
          media: {
            mediaKey,
            bucketId: 'tux-whatsapp-media',
            objectPath: `media/${shopId}/${mediaKey}`,
            mimeType: String(input['mimeType']),
            fileName: (input['fileName'] as string | null | undefined) ?? null,
            byteSize: Number(input['byteSize']),
            sha256: 'canonical-sha256',
            storedAt,
            expiresAt,
          },
        };
      },
    ),
  };
  const diagnosticSink = vi.fn();
  return { channelResolver, materializer, providerGateway, mediaStore, diagnosticSink, events };
}

function webhookDependencies(deps: ReturnType<typeof dependencies>) {
  return {
    appSecret,
    webhookVerifyToken,
    channelResolver: deps.channelResolver,
    materializer: deps.materializer,
    providerGateway: deps.providerGateway,
    mediaStore: deps.mediaStore,
    diagnosticSink: deps.diagnosticSink,
  } as unknown as Parameters<typeof handleWhatsAppWebhook>[1];
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
    webhookDependencies(deps),
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
      webhookDependencies(deps),
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
      webhookDependencies(deps),
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
    expect(deps.providerGateway.fetchMedia).not.toHaveBeenCalled();
    expect(deps.mediaStore.storeInboundMedia).not.toHaveBeenCalled();
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

  it('delegates duplicate text provider-message idempotency to the v1 materializer', async () => {
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
    const baseDependencies = webhookDependencies(deps);

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
    ['image', 'media-image', 'IMAGE', 'image/jpeg', null],
    ['document', 'media-doc', 'DOCUMENT', 'application/pdf', 'invoice.pdf'],
    ['audio', 'media-audio', 'AUDIO', 'audio/ogg', null],
  ] as const)(
    'downloads, privately stores, and v2-materializes verified %s media before acknowledging',
    async (type, providerMediaId, kind, mimeType, fileName) => {
      const deps = dependencies();
      const providerBytes =
        kind === 'DOCUMENT'
          ? new TextEncoder().encode('%PDF-1.7\n')
          : kind === 'AUDIO'
            ? new TextEncoder().encode('OggS____OpusHead')
            : new Uint8Array([0xff, 0xd8, 0xff, 0x01]);
      deps.providerGateway.fetchMedia.mockImplementationOnce(async () => {
        deps.events.push('fetch-media');
        return {
          mimeType,
          byteSize: providerBytes.byteLength,
          sha256: `${type}-provider-sha`,
          body: new Response(providerBytes).body!,
        };
      });
      const payload = binaryPayload({
        type,
        providerMediaId,
        mimeType,
        ...(fileName === null ? {} : { fileName }),
      });
      const mediaKey = inboundMediaKey('wamid.media-1');

      const result = await post(payload, deps);

      expect(result).toEqual({
        status: 200,
        body: '{"ok":true}',
        contentType: 'application/json; charset=utf-8',
      });
      expect(deps.events).toEqual(['resolve', 'fetch-media', 'store-media', 'materialize-media']);
      expect(deps.providerGateway.fetchMedia).toHaveBeenCalledWith({ providerMediaId });
      expect(deps.mediaStore.storeInboundMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          shopId,
          providerMessageId: 'wamid.media-1',
          kind,
          mimeType,
          byteSize: providerBytes.byteLength,
          fileName,
        }),
      );
      expect(deps.materializer.materializeInboundMedia).toHaveBeenCalledWith({
        shopId,
        providerMessageId: 'wamid.media-1',
        normalizedPhone: '01012345678',
        displayPhone: '+201012345678',
        kind,
        providerMediaId,
        mediaKey,
        bucketId: 'tux-whatsapp-media',
        objectPath: `media/${shopId}/${mediaKey}`,
        mimeType,
        fileName,
        byteSize: providerBytes.byteLength,
        sha256: 'canonical-sha256',
        storedAt,
        expiresAt,
        providerOccurredAt: '2026-09-02T19:00:00.000Z',
      });
      expect(deps.materializer.materializeInbound).not.toHaveBeenCalled();
      expect(result.body).not.toContain(providerMediaId);
    },
  );

  it('uses the same deterministic mediaKey for duplicate webhook delivery so the v2 RPC owns unread idempotency', async () => {
    const deps = dependencies();
    const payload = binaryPayload({
      type: 'image',
      providerMediaId: 'media-image',
      mimeType: 'image/jpeg',
      messageId: 'wamid.duplicate-media',
    });
    const expectedMediaKey = inboundMediaKey('wamid.duplicate-media');

    await post(payload, deps);
    await post(payload, deps);

    expect(deps.materializer.materializeInboundMedia).toHaveBeenCalledTimes(2);
    for (const call of deps.materializer.materializeInboundMedia.mock.calls) {
      expect(call[0]).toMatchObject({
        shopId,
        providerMessageId: 'wamid.duplicate-media',
        mediaKey: expectedMediaKey,
      });
      expect(call[0]).not.toMatchObject({ mediaKey: 'media-image' });
    }
  });

  it('returns 503 without storage/materialization when provider media download is unavailable so Meta can retry', async () => {
    const deps = dependencies();
    deps.providerGateway.fetchMedia.mockRejectedValueOnce(
      new WhatsAppProviderError(null, null, 'WhatsApp provider media is unavailable.'),
    );
    const payload = binaryPayload({
      type: 'document',
      providerMediaId: 'media-doc',
      mimeType: 'application/pdf',
      fileName: 'invoice.pdf',
    });

    const result = await post(payload, deps);

    expect(result.status).toBe(503);
    expect(result.body).toBe('{"error":"whatsapp_media_unavailable"}');
    expect(deps.mediaStore.storeInboundMedia).not.toHaveBeenCalled();
    expect(deps.materializer.materializeInboundMedia).not.toHaveBeenCalled();
    expect(result.body).not.toContain('media-doc');
  });

  it.each(['MIME_NOT_ALLOWED', 'TOO_LARGE', 'CONTENT_MISMATCH'] as const)(
    'acknowledges permanently rejected inbound media safely for %s without client-visible materialization',
    async (code) => {
      const deps = dependencies();
      deps.mediaStore.storeInboundMedia.mockResolvedValueOnce({ status: 'REJECTED', code });
      const payload = binaryPayload({
        type: 'image',
        providerMediaId: 'provider-secret-media-id',
        mimeType: 'image/webp',
      });

      const result = await post(payload, deps);

      expect(result.status).toBe(200);
      expect(result.body).toBe('{"ok":true}');
      expect(deps.materializer.materializeInboundMedia).not.toHaveBeenCalled();
      expect(deps.materializer.materializeInbound).not.toHaveBeenCalled();
      expect(deps.diagnosticSink).toHaveBeenCalledWith('media_rejected');
      expect(result.body).not.toContain('provider-secret-media-id');
    },
  );

  it('persists location as contextual metadata without provider download or binary storage', async () => {
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
    expect(deps.providerGateway.fetchMedia).not.toHaveBeenCalled();
    expect(deps.mediaStore.storeInboundMedia).not.toHaveBeenCalled();
    expect(deps.materializer.materializeInboundMedia).not.toHaveBeenCalled();
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
