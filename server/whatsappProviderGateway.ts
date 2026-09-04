import { normalizeEgyptianPhone } from '@tux/domain';

export type SendWhatsAppProviderMessageInput =
  | {
      readonly providerPhoneNumberId: string;
      readonly to: string;
      readonly kind: 'TEXT';
      readonly text: string;
    }
  | {
      readonly providerPhoneNumberId: string;
      readonly to: string;
      readonly kind: 'TEMPLATE';
      readonly providerTemplateName: string;
      readonly languageCode: string;
    };

export interface WhatsAppProviderMedia {
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string | null;
  readonly body: ReadableStream<Uint8Array>;
}

export interface WhatsAppProviderGateway {
  sendMessage(
    input: SendWhatsAppProviderMessageInput,
  ): Promise<{ readonly providerMessageId: string }>;
  fetchMedia(input: { readonly providerMediaId: string }): Promise<WhatsAppProviderMedia>;
}

interface WhatsAppProviderConfig {
  readonly graphVersion: string;
  readonly accessToken: string;
}

export class WhatsAppProviderError extends Error {
  readonly httpStatus: number | null;
  readonly providerCode: number | null;
  readonly safeMessage: string;

  constructor(httpStatus: number | null, providerCode: number | null, safeMessage: string) {
    super(safeMessage);
    this.name = 'WhatsAppProviderError';
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.safeMessage = safeMessage;
  }
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

function mediaMetadata(value: unknown): {
  readonly url: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly sha256: string | null;
} | null {
  const source = record(value);
  if (source === null) return null;
  const rawUrl = nonEmptyString(source['url']);
  const mimeType = nonEmptyString(source['mime_type']);
  const byteSize = source['file_size'];
  const sha256 = source['sha256'] === undefined ? null : nonEmptyString(source['sha256']);
  if (
    rawUrl === null ||
    mimeType === null ||
    typeof byteSize !== 'number' ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0 ||
    (source['sha256'] !== undefined && sha256 === null)
  ) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
    return { url: url.toString(), mimeType, byteSize, sha256 };
  } catch {
    return null;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createWhatsAppProviderGateway(
  config: WhatsAppProviderConfig,
  fetchImpl: typeof fetch = fetch,
): WhatsAppProviderGateway {
  const graphVersion = config.graphVersion.trim();
  const accessToken = config.accessToken.trim();
  if (graphVersion.length === 0 || accessToken.length === 0) {
    throw new Error('WhatsApp provider configuration is incomplete.');
  }

  return {
    async sendMessage(input) {
      const providerPhoneNumberId = input.providerPhoneNumberId.trim();
      if (providerPhoneNumberId.length === 0) {
        throw new Error('WhatsApp provider phone identity is invalid.');
      }
      if (input.kind === 'TEXT') {
        if (input.text.trim().length === 0) {
          throw new Error('WhatsApp message text is empty.');
        }
      } else if (
        input.providerTemplateName.trim().length === 0 ||
        input.languageCode.trim().length === 0
      ) {
        throw new Error('WhatsApp template metadata is invalid.');
      }

      const phone = normalizeEgyptianPhone(input.to);
      if (!phone.valid) {
        throw new Error('WhatsApp recipient phone is invalid.');
      }
      const recipient = phone.displayPhone.slice(1);

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
            body: JSON.stringify(
              input.kind === 'TEXT'
                ? {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: recipient,
                    type: 'text',
                    text: { body: input.text },
                  }
                : {
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: recipient,
                    type: 'template',
                    template: {
                      name: input.providerTemplateName,
                      language: { code: input.languageCode },
                    },
                  },
            ),
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

    async fetchMedia(input) {
      const providerMediaId = input.providerMediaId.trim();
      if (providerMediaId.length === 0) {
        throw new Error('WhatsApp provider media identity is invalid.');
      }

      let metadataResponse: Response;
      try {
        metadataResponse = await fetchImpl(
          `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(providerMediaId)}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
      } catch {
        throw new WhatsAppProviderError(null, null, 'WhatsApp provider media is unavailable.');
      }

      const metadataPayload = await safeJson(metadataResponse);
      if (!metadataResponse.ok) {
        throw new WhatsAppProviderError(
          metadataResponse.status,
          providerCode(metadataPayload),
          'WhatsApp provider media is unavailable.',
        );
      }
      const metadata = mediaMetadata(metadataPayload);
      if (metadata === null) {
        throw new WhatsAppProviderError(
          metadataResponse.status,
          null,
          'WhatsApp provider media is unavailable.',
        );
      }

      let downloadResponse: Response;
      try {
        downloadResponse = await fetchImpl(metadata.url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        throw new WhatsAppProviderError(null, null, 'WhatsApp provider media is unavailable.');
      }
      if (!downloadResponse.ok || downloadResponse.body === null) {
        throw new WhatsAppProviderError(
          downloadResponse.status,
          null,
          'WhatsApp provider media is unavailable.',
        );
      }

      return {
        mimeType: metadata.mimeType,
        byteSize: metadata.byteSize,
        sha256: metadata.sha256,
        body: downloadResponse.body,
      };
    },
  };
}
