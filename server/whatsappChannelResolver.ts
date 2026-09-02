import { parseEntityId, type ShopId } from '@tux/domain';

export type WhatsAppProvider = 'META_CLOUD_API';

export interface InboundWhatsAppChannel {
  readonly channelId: string;
  readonly shopId: ShopId;
}

export interface OutboundWhatsAppChannel {
  readonly channelId: string;
  readonly provider: WhatsAppProvider;
  readonly providerPhoneNumberId: string;
}

export interface WhatsAppChannelResolver {
  resolveInboundChannel(input: {
    readonly provider: WhatsAppProvider;
    readonly providerPhoneNumberId: string;
  }): Promise<InboundWhatsAppChannel | null>;

  resolveOutboundChannel(input: {
    readonly shopId: ShopId;
  }): Promise<OutboundWhatsAppChannel | null>;
}

interface ResolverConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function oneRow(value: unknown): Record<string, unknown> | null {
  if (!Array.isArray(value)) {
    throw new Error('WhatsApp channel resolver returned an invalid response.');
  }
  if (value.length === 0) return null;
  if (value.length !== 1 || typeof value[0] !== 'object' || value[0] === null || Array.isArray(value[0])) {
    throw new Error('WhatsApp channel resolver returned an invalid response.');
  }
  return value[0] as Record<string, unknown>;
}

export class SupabaseWhatsAppChannelResolver implements WhatsAppChannelResolver {
  readonly #config: ResolverConfig;
  readonly #fetch: typeof fetch;

  constructor(config: ResolverConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async #callRpc(functionName: string, body: Readonly<Record<string, string>>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#config.projectUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: this.#config.serviceRoleKey,
          Authorization: `Bearer ${this.#config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('WhatsApp channel resolver is unavailable.');
    }

    if (!response.ok) {
      throw new Error('WhatsApp channel resolver is unavailable.');
    }

    try {
      return await response.json();
    } catch {
      throw new Error('WhatsApp channel resolver returned an invalid response.');
    }
  }

  async resolveInboundChannel(input: {
    readonly provider: WhatsAppProvider;
    readonly providerPhoneNumberId: string;
  }): Promise<InboundWhatsAppChannel | null> {
    const payload = await this.#callRpc('resolve_tux_whatsapp_inbound_channel_v1', {
      p_provider: input.provider,
      p_provider_phone_number_id: input.providerPhoneNumberId,
    });
    const row = oneRow(payload);
    if (row === null) return null;

    const channelId = nonEmptyString(row['channel_id']);
    const shopId = nonEmptyString(row['shop_id']);
    if (channelId === null || shopId === null) {
      throw new Error('WhatsApp channel resolver returned an invalid response.');
    }

    try {
      parseEntityId(channelId);
      return { channelId, shopId: parseEntityId<ShopId>(shopId) };
    } catch {
      throw new Error('WhatsApp channel resolver returned an invalid response.');
    }
  }

  async resolveOutboundChannel(input: {
    readonly shopId: ShopId;
  }): Promise<OutboundWhatsAppChannel | null> {
    const payload = await this.#callRpc('resolve_tux_whatsapp_outbound_channel_v1', {
      p_shop_id: input.shopId,
    });
    const row = oneRow(payload);
    if (row === null) return null;

    const channelId = nonEmptyString(row['channel_id']);
    const provider = nonEmptyString(row['provider']);
    const providerPhoneNumberId = nonEmptyString(row['provider_phone_number_id']);
    if (
      channelId === null ||
      provider !== 'META_CLOUD_API' ||
      providerPhoneNumberId === null
    ) {
      throw new Error('WhatsApp channel resolver returned an invalid response.');
    }

    try {
      parseEntityId(channelId);
    } catch {
      throw new Error('WhatsApp channel resolver returned an invalid response.');
    }

    return {
      channelId,
      provider,
      providerPhoneNumberId,
    };
  }
}
