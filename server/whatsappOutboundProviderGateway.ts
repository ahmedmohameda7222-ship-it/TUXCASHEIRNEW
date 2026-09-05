import { normalizeEgyptianPhone } from '@tux/domain';
import {
  createWhatsAppProviderGateway,
  WhatsAppProviderError,
  type SendWhatsAppProviderMessageInput,
  type WhatsAppProviderGateway,
} from './whatsappProviderGateway';

export type SendWhatsAppExtendedProviderMessageInput =
  | SendWhatsAppProviderMessageInput
  | {
      readonly providerPhoneNumberId: string;
      readonly to: string;
      readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
      readonly mediaUrl: string;
      readonly fileName: string | null;
    }
  | {
      readonly providerPhoneNumberId: string;
      readonly to: string;
      readonly kind: 'LOCATION';
      readonly latitude: number;
      readonly longitude: number;
      readonly name: string | null;
      readonly address: string | null;
    };

export interface WhatsAppExtendedProviderGateway
  extends Omit<WhatsAppProviderGateway, 'sendMessage'> {
  sendMessage(
    input: SendWhatsAppExtendedProviderMessageInput,
  ): Promise<{ readonly providerMessageId: string }>;
}

interface WhatsAppExtendedProviderConfig {
  readonly graphVersion: string;
  readonly accessToken: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function providerCode(value: unknown): number | null {
  const source = record(value);
  const error = source === null ? null : record(source['error']);
  const code = error?.['code'];
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : null;
}

function providerMessageId(value: unknown): string | null {
  const source = record(value);
  const messages = source?.['messages'];
  if (!Array.isArray(messages) || messages.length === 0) return null;
  return nonEmptyString(record(messages[0])?.['id']);
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeMediaUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new Error('WhatsApp media access URL is invalid.');
  }
}

function providerPayload(
  input: Exclude<SendWhatsAppExtendedProviderMessageInput, SendWhatsAppProviderMessageInput>,
) {
  const phone = normalizeEgyptianPhone(input.to);
  if (!phone.valid) throw new Error('WhatsApp recipient phone is invalid.');
  const to = phone.displayPhone.slice(1);

  if (input.kind === 'LOCATION') {
    if (
      !Number.isFinite(input.latitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      !Number.isFinite(input.longitude) ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      throw new Error('WhatsApp location is invalid.');
    }
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        ...(input.name === null ? {} : { name: input.name }),
        ...(input.address === null ? {} : { address: input.address }),
      },
    };
  }

  const link = safeMediaUrl(input.mediaUrl);
  const type = input.kind.toLowerCase() as 'image' | 'document' | 'audio';
  const media = {
    link,
    ...(input.kind === 'DOCUMENT' && input.fileName !== null
      ? { filename: input.fileName }
      : {}),
  };
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type,
    [type]: media,
  };
}

export function createWhatsAppExtendedProviderGateway(
  config: WhatsAppExtendedProviderConfig,
  fetchImpl: typeof fetch = fetch,
): WhatsAppExtendedProviderGateway {
  const base = createWhatsAppProviderGateway(config, fetchImpl);
  const graphVersion = config.graphVersion.trim();
  const accessToken = config.accessToken.trim();

  return {
    fetchMedia: base.fetchMedia,
    async sendMessage(input) {
      if (input.kind === 'TEXT' || input.kind === 'TEMPLATE') {
        return base.sendMessage(input);
      }
      const providerPhoneNumberId = input.providerPhoneNumberId.trim();
      if (providerPhoneNumberId.length === 0) {
        throw new Error('WhatsApp provider phone identity is invalid.');
      }

      let response: Response;
      try {
        response = await fetchImpl(
          `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(providerPhoneNumberId)}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(providerPayload(input)),
          },
        );
      } catch {
        throw new WhatsAppProviderError(null, null, 'WhatsApp provider is unavailable.');
      }

      const payload = await safeJson(response);
      if (!response.ok) {
        throw new WhatsAppProviderError(
          response.status,
          providerCode(payload),
          'WhatsApp provider rejected the request.',
        );
      }
      const messageId = providerMessageId(payload);
      if (messageId === null) {
        throw new WhatsAppProviderError(
          response.status,
          null,
          'WhatsApp provider returned an invalid response.',
        );
      }
      return { providerMessageId: messageId };
    },
  };
}
