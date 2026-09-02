import { normalizeEgyptianPhone } from '@tux/domain';

export interface WhatsAppProviderGateway {
  sendMessage(input: {
    readonly providerPhoneNumberId: string;
    readonly to: string;
    readonly kind: 'TEXT';
    readonly text: string;
  }): Promise<{ readonly providerMessageId: string }>;
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

function providerCode(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const code = (error as Record<string, unknown>)['code'];
  return typeof code === 'number' && Number.isSafeInteger(code) ? code : null;
}

function providerMessageId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const messages = (value as Record<string, unknown>)['messages'];
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const first = messages[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return null;
  const id = (first as Record<string, unknown>)['id'];
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
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
      if (input.kind !== 'TEXT') {
        throw new Error('WhatsApp message kind is unsupported.');
      }
      if (input.text.trim().length === 0) {
        throw new Error('WhatsApp message text is empty.');
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
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: recipient,
              type: 'text',
              text: { body: input.text },
            }),
          },
        );
      } catch {
        throw new WhatsAppProviderError(null, null, 'WhatsApp provider is unavailable.');
      }

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A non-JSON provider response is handled as a safe protocol failure below.
      }

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
