import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeEgyptianPhone, type ShopId } from '@tux/domain';
import type { WhatsAppChannelResolver } from './whatsappChannelResolver';

export interface WhatsAppWebhookInput {
  readonly method: string | undefined;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawBody: Buffer;
}

export interface WhatsAppWebhookResult {
  readonly status: number;
  readonly body: string;
  readonly contentType: 'application/json; charset=utf-8' | 'text/plain; charset=utf-8';
}

export interface WhatsAppInboundMaterializeInput {
  readonly shopId: ShopId;
  readonly providerMessageId: string;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION';
  readonly text: string | null;
  readonly mediaRef: string | null;
  readonly mediaMetadata: Readonly<Record<string, unknown>>;
  readonly providerOccurredAt: string | null;
}

export interface WhatsAppInboundMaterializer {
  materializeInbound(input: WhatsAppInboundMaterializeInput): Promise<void>;
}

export type WhatsAppWebhookDiagnostic =
  | 'invalid_payload'
  | 'unknown_channel'
  | 'invalid_sender_phone'
  | 'unsupported_message'
  | 'channel_resolver_unavailable'
  | 'materializer_unavailable';

export interface WhatsAppWebhookDependencies {
  readonly appSecret: string;
  readonly webhookVerifyToken: string;
  readonly channelResolver: WhatsAppChannelResolver;
  readonly materializer: WhatsAppInboundMaterializer;
  readonly diagnosticSink?: (diagnostic: WhatsAppWebhookDiagnostic) => void;
}

interface MaterializerConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
}

function jsonResult(status: number, body: Readonly<Record<string, unknown>>): WhatsAppWebhookResult {
  return {
    status,
    body: JSON.stringify(body),
    contentType: 'application/json; charset=utf-8',
  };
}

function plainResult(status: number, body: string): WhatsAppWebhookResult {
  return { status, body, contentType: 'text/plain; charset=utf-8' };
}

function firstHeader(
  headers: WhatsAppWebhookInput['headers'],
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' && first.trim().length > 0 ? first.trim() : null;
  }
  return null;
}

function emitDiagnostic(
  dependencies: WhatsAppWebhookDependencies,
  diagnostic: WhatsAppWebhookDiagnostic,
): void {
  try {
    dependencies.diagnosticSink?.(diagnostic);
  } catch {
    // Diagnostics are non-authoritative and must never break webhook processing.
  }
}

export function verifyMetaWebhookSignature(
  rawBody: Buffer,
  receivedSignature: string | null,
  appSecret: string,
): boolean {
  if (receivedSignature === null || !receivedSignature.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const receivedBytes = Buffer.from(receivedSignature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (receivedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(receivedBytes, expectedBytes);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = record(item);
    return parsed === null ? [] : [parsed];
  });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalString(source: Record<string, unknown>, key: string): string | null {
  return nonEmptyString(source[key]);
}

function providerOccurredAt(timestamp: unknown): string | null {
  const raw = nonEmptyString(timestamp);
  if (raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

interface TranslatedProviderMessage {
  readonly providerMessageId: string;
  readonly senderPhone: string;
  readonly kind: WhatsAppInboundMaterializeInput['kind'];
  readonly text: string | null;
  readonly mediaRef: string | null;
  readonly mediaMetadata: Readonly<Record<string, unknown>>;
  readonly providerOccurredAt: string | null;
}

function mediaMetadata(
  media: Record<string, unknown>,
  allowedStrings: readonly string[],
  includeVoice = false,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of allowedStrings) {
    const value = optionalString(media, key);
    if (value === null) continue;
    const outputKey = key === 'mime_type' ? 'mimeType' : key;
    metadata[outputKey] = value;
  }
  if (includeVoice && typeof media['voice'] === 'boolean') {
    metadata['voice'] = media['voice'];
  }
  return metadata;
}

function translateProviderMessage(message: Record<string, unknown>): TranslatedProviderMessage | null {
  const providerMessageId = nonEmptyString(message['id']);
  const senderPhone = nonEmptyString(message['from']);
  const type = nonEmptyString(message['type']);
  if (providerMessageId === null || senderPhone === null || type === null) return null;

  const occurredAt = providerOccurredAt(message['timestamp']);
  if (type === 'text') {
    const text = record(message['text']);
    const body = text === null ? null : nonEmptyString(text['body']);
    if (body === null) return null;
    return {
      providerMessageId,
      senderPhone,
      kind: 'TEXT',
      text: body,
      mediaRef: null,
      mediaMetadata: {},
      providerOccurredAt: occurredAt,
    };
  }

  if (type === 'image' || type === 'document' || type === 'audio') {
    const media = record(message[type]);
    const id = media === null ? null : nonEmptyString(media['id']);
    if (media === null || id === null) return null;
    const kind = type === 'image' ? 'IMAGE' : type === 'document' ? 'DOCUMENT' : 'AUDIO';
    const allowed =
      type === 'document'
        ? ['mime_type', 'sha256', 'filename', 'caption']
        : type === 'image'
          ? ['mime_type', 'sha256', 'caption']
          : ['mime_type', 'sha256'];
    return {
      providerMessageId,
      senderPhone,
      kind,
      text: null,
      mediaRef: id,
      mediaMetadata: mediaMetadata(media, allowed, type === 'audio'),
      providerOccurredAt: occurredAt,
    };
  }

  if (type === 'location') {
    const location = record(message['location']);
    if (location === null) return null;
    const latitude = location['latitude'];
    const longitude = location['longitude'];
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude)
    ) {
      return null;
    }
    const metadata: Record<string, unknown> = { latitude, longitude };
    const name = optionalString(location, 'name');
    const address = optionalString(location, 'address');
    if (name !== null) metadata['name'] = name;
    if (address !== null) metadata['address'] = address;
    return {
      providerMessageId,
      senderPhone,
      kind: 'LOCATION',
      text: null,
      mediaRef: null,
      mediaMetadata: metadata,
      providerOccurredAt: occurredAt,
    };
  }

  return null;
}

export class SupabaseWhatsAppInboundMaterializer implements WhatsAppInboundMaterializer {
  readonly #config: MaterializerConfig;
  readonly #fetch: typeof fetch;

  constructor(config: MaterializerConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async materializeInbound(input: WhatsAppInboundMaterializeInput): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#config.projectUrl}/rest/v1/rpc/materialize_tux_whatsapp_inbound_v1`,
        {
          method: 'POST',
          headers: {
            apikey: this.#config.serviceRoleKey,
            Authorization: `Bearer ${this.#config.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_shop_id: input.shopId,
            p_provider_message_id: input.providerMessageId,
            p_normalized_phone: input.normalizedPhone,
            p_display_phone: input.displayPhone,
            p_kind: input.kind,
            p_text: input.text,
            p_media_ref: input.mediaRef,
            p_media_metadata: input.mediaMetadata,
            p_provider_occurred_at: input.providerOccurredAt,
          }),
        },
      );
    } catch {
      throw new Error('WhatsApp inbound materializer is unavailable.');
    }

    if (!response.ok) {
      throw new Error('WhatsApp inbound materializer is unavailable.');
    }
  }
}

async function handleVerifiedPost(
  input: WhatsAppWebhookInput,
  dependencies: WhatsAppWebhookDependencies,
): Promise<WhatsAppWebhookResult> {
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8')) as unknown;
  } catch {
    emitDiagnostic(dependencies, 'invalid_payload');
    return jsonResult(400, { error: 'invalid_webhook_payload' });
  }

  const root = record(payload);
  if (root === null) {
    emitDiagnostic(dependencies, 'invalid_payload');
    return jsonResult(400, { error: 'invalid_webhook_payload' });
  }

  for (const entry of records(root['entry'])) {
    for (const change of records(entry['changes'])) {
      if (change['field'] !== 'messages') continue;
      const value = record(change['value']);
      if (value === null) continue;
      const messages = records(value['messages']);
      if (messages.length === 0) continue;
      const metadata = record(value['metadata']);
      const providerPhoneNumberId =
        metadata === null ? null : nonEmptyString(metadata['phone_number_id']);
      if (providerPhoneNumberId === null) {
        emitDiagnostic(dependencies, 'invalid_payload');
        continue;
      }

      let channel;
      try {
        channel = await dependencies.channelResolver.resolveInboundChannel({
          provider: 'META_CLOUD_API',
          providerPhoneNumberId,
        });
      } catch {
        emitDiagnostic(dependencies, 'channel_resolver_unavailable');
        return jsonResult(503, { error: 'whatsapp_channel_resolution_unavailable' });
      }

      if (channel === null) {
        emitDiagnostic(dependencies, 'unknown_channel');
        continue;
      }

      for (const providerMessage of messages) {
        const translated = translateProviderMessage(providerMessage);
        if (translated === null) {
          emitDiagnostic(dependencies, 'unsupported_message');
          continue;
        }

        const phone = normalizeEgyptianPhone(translated.senderPhone);
        if (!phone.valid) {
          emitDiagnostic(dependencies, 'invalid_sender_phone');
          continue;
        }

        try {
          await dependencies.materializer.materializeInbound({
            shopId: channel.shopId,
            providerMessageId: translated.providerMessageId,
            normalizedPhone: phone.normalizedPhone,
            displayPhone: phone.displayPhone,
            kind: translated.kind,
            text: translated.text,
            mediaRef: translated.mediaRef,
            mediaMetadata: translated.mediaMetadata,
            providerOccurredAt: translated.providerOccurredAt,
          });
        } catch {
          emitDiagnostic(dependencies, 'materializer_unavailable');
          return jsonResult(503, { error: 'whatsapp_materialization_unavailable' });
        }
      }
    }
  }

  return jsonResult(200, { ok: true });
}

export async function handleWhatsAppWebhook(
  input: WhatsAppWebhookInput,
  dependencies: WhatsAppWebhookDependencies,
): Promise<WhatsAppWebhookResult> {
  const method = input.method?.toUpperCase() ?? '';
  if (method === 'GET') {
    let url: URL;
    try {
      url = new URL(input.url, 'https://tux.invalid');
    } catch {
      return plainResult(403, 'Forbidden');
    }
    const mode = url.searchParams.get('hub.mode');
    const verifyToken = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (
      mode === 'subscribe' &&
      verifyToken === dependencies.webhookVerifyToken &&
      challenge !== null
    ) {
      return plainResult(200, challenge);
    }
    return plainResult(403, 'Forbidden');
  }

  if (method !== 'POST') {
    return jsonResult(405, { error: 'method_not_allowed' });
  }

  const signature = firstHeader(input.headers, 'x-hub-signature-256');
  if (!verifyMetaWebhookSignature(input.rawBody, signature, dependencies.appSecret)) {
    return jsonResult(401, { error: 'invalid_webhook_signature' });
  }

  return handleVerifiedPost(input, dependencies);
}
