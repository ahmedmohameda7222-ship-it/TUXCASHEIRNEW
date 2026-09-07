import { parseWhatsAppMessage } from '@tux/application';
import type {
  BusinessDayId,
  DeviceId,
  ShopId,
  WhatsAppLocationPayload,
  WhatsAppMessage,
  WorkerId,
} from '@tux/domain';
import {
  SupabaseWhatsAppOperationsRepository,
  WhatsAppOperationsRepositoryError,
  type ClaimedWhatsAppOutboundIntent,
} from './whatsappOperationsRepository';
import type { WhatsAppDataServerConfig } from './whatsappServerConfig';

export interface WhatsAppOutboundMediaMetadata {
  readonly mediaKey: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly objectPath: string;
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly sha256: string | null;
  readonly storedAt: string;
  readonly expiresAt: string;
}

export interface WhatsAppMediaAccessRecord {
  readonly messageId: string;
  readonly objectPath: string;
  readonly expiresAt: string;
  readonly deletedAt: string | null;
}

export interface WhatsAppOutboundRepository {
  claimOutboundMediaIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: WhatsAppOutboundMediaMetadata;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent>;

  claimOutboundLocationIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: WhatsAppLocationPayload;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent>;

  resolveRetryableMessage(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
  }): Promise<WhatsAppMessage | null>;

  claimRetryIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly messageId: string;
    readonly outboundIntentKey: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent>;

  resolveMediaAccess(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
  }): Promise<WhatsAppMediaAccessRecord | null>;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WhatsAppOperationsRepositoryError(
      'PROTOCOL_ERROR',
      'WhatsApp remote returned an invalid response.',
    );
  }
  return value as UnknownRecord;
}

function oneRow(value: unknown): UnknownRecord | null {
  if (!Array.isArray(value)) throw protocolError();
  if (value.length === 0) return null;
  if (value.length !== 1) throw protocolError();
  return record(value[0]);
}

function protocolError(): WhatsAppOperationsRepositoryError {
  return new WhatsAppOperationsRepositoryError(
    'PROTOCOL_ERROR',
    'WhatsApp remote returned an invalid response.',
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw protocolError();
  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') throw protocolError();
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw protocolError();
  return value;
}

function integerValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw protocolError();
  return value;
}

function mediaWire(value: unknown): unknown {
  if (value === null) return null;
  const source = record(value);
  return {
    mediaKey: requiredString(source['media_key']),
    kind: requiredString(source['kind']),
    mimeType: requiredString(source['mime_type']),
    fileName: nullableString(source['file_name']),
    byteSize: integerValue(source['byte_size']),
    storedAt: requiredString(source['stored_at']),
    expiresAt: requiredString(source['expires_at']),
    availability: requiredString(source['availability']),
  };
}

function locationWire(value: unknown): unknown {
  if (value === null) return null;
  const source = record(value);
  return {
    latitude: finiteNumber(source['latitude']),
    longitude: finiteNumber(source['longitude']),
    name: source['name'] === null ? null : requiredString(source['name']),
    address: source['address'] === null ? null : requiredString(source['address']),
  };
}

function parseInternalMessage(
  rawMessage: unknown,
  rawMedia: unknown,
  rawLocation: unknown,
): WhatsAppMessage {
  const source = record(rawMessage);
  return parseWhatsAppMessage({
    id: requiredString(source['id']),
    shopId: requiredString(source['shop_id']),
    conversationId: requiredString(source['conversation_id']),
    providerMessageId:
      source['provider_message_id'] === null ? null : requiredString(source['provider_message_id']),
    outboundIntentKey:
      source['outbound_intent_key'] === null ? null : requiredString(source['outbound_intent_key']),
    direction: requiredString(source['direction']),
    kind: requiredString(source['kind']),
    text: source['text'] === null ? null : requiredString(source['text']),
    mediaRef: source['media_ref'] === null ? null : requiredString(source['media_ref']),
    media: mediaWire(rawMedia),
    location: locationWire(rawLocation),
    status: requiredString(source['status']),
    sentByWorkerId:
      source['sent_by_worker_id'] === null ? null : requiredString(source['sent_by_worker_id']),
    initiatedByDeviceId:
      source['initiated_by_device_id'] === null
        ? null
        : requiredString(source['initiated_by_device_id']),
    initiatedAt: source['initiated_at'] === null ? null : requiredString(source['initiated_at']),
    createdAt: requiredString(source['created_at']),
  });
}

function outboundMediaMetadata(media: WhatsAppOutboundMediaMetadata): UnknownRecord {
  return {
    media_key: media.mediaKey,
    object_path: media.objectPath,
    mime_type: media.mimeType,
    file_name: media.fileName,
    byte_size: media.byteSize,
    sha256: media.sha256,
    stored_at: media.storedAt,
    expires_at: media.expiresAt,
  };
}

function outboundMediaWire(media: WhatsAppOutboundMediaMetadata): UnknownRecord {
  return {
    media_key: media.mediaKey,
    kind: media.kind,
    mime_type: media.mimeType,
    file_name: media.fileName,
    byte_size: media.byteSize,
    stored_at: media.storedAt,
    expires_at: media.expiresAt,
    availability: 'AVAILABLE',
  };
}

function outboundLocationMetadata(location: WhatsAppLocationPayload): UnknownRecord {
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    name: location.name,
    address: location.address,
  };
}

export class SupabaseWhatsAppOutboundRepository
  extends SupabaseWhatsAppOperationsRepository
  implements WhatsAppOutboundRepository
{
  readonly #outboundConfig: WhatsAppDataServerConfig;
  readonly #outboundFetch: typeof fetch;

  constructor(config: WhatsAppDataServerConfig, fetchImpl: typeof fetch = fetch) {
    super(config, fetchImpl);
    this.#outboundConfig = config;
    this.#outboundFetch = fetchImpl;
  }

  async #callOutboundRpc(functionName: string, body: UnknownRecord): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#outboundFetch(
        `${this.#outboundConfig.projectUrl}/rest/v1/rpc/${functionName}`,
        {
          method: 'POST',
          headers: {
            apikey: this.#outboundConfig.serviceRoleKey,
            Authorization: `Bearer ${this.#outboundConfig.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new WhatsAppOperationsRepositoryError(
        'REMOTE_UNAVAILABLE',
        'WhatsApp remote is unavailable.',
      );
    }

    const text = await response.text().catch(() => {
      throw protocolError();
    });
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw protocolError();
      }
    }

    if (!response.ok) {
      const source =
        typeof payload === 'object' && payload !== null && !Array.isArray(payload)
          ? (payload as UnknownRecord)
          : null;
      const message = typeof source?.['message'] === 'string' ? source['message'] : null;
      if (message === 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED') {
        throw new WhatsAppOperationsRepositoryError(
          'OPERATOR_NOT_SYNCHRONIZED',
          'WhatsApp Current Operator is not synchronized.',
        );
      }
      if (
        message === 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT' ||
        message === 'TUX_WHATSAPP_RETRY_NOT_ALLOWED' ||
        message === 'TUX_WHATSAPP_MEDIA_EXPIRED'
      ) {
        throw new WhatsAppOperationsRepositoryError(
          'OUTBOUND_INTENT_CONFLICT',
          'WhatsApp outbound intent conflicts with an existing durable intent.',
        );
      }
      throw new WhatsAppOperationsRepositoryError(
        'REMOTE_REJECTED',
        'WhatsApp remote rejected the request.',
      );
    }

    return payload;
  }

  async claimOutboundMediaIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: WhatsAppOutboundMediaMetadata;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent> {
    const row = oneRow(
      await this.#callOutboundRpc('claim_tux_whatsapp_outbound_intent_v2', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
        p_device_id: input.deviceId,
        p_conversation_id: input.conversationId,
        p_outbound_intent_key: input.outboundIntentKey,
        p_kind: input.media.kind,
        p_text: null,
        p_media_ref: input.media.mediaKey,
        p_media_metadata: outboundMediaMetadata(input.media),
        p_initiated_at: input.initiatedAt,
      }),
    );
    if (row === null) throw protocolError();
    return {
      created: booleanValue(row['created']),
      recipientNormalizedPhone: requiredString(row['recipient_normalized_phone']),
      message: parseInternalMessage(row['message_json'], outboundMediaWire(input.media), null),
    };
  }

  async claimOutboundLocationIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: WhatsAppLocationPayload;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent> {
    const row = oneRow(
      await this.#callOutboundRpc('claim_tux_whatsapp_outbound_intent_v2', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
        p_device_id: input.deviceId,
        p_conversation_id: input.conversationId,
        p_outbound_intent_key: input.outboundIntentKey,
        p_kind: 'LOCATION',
        p_text: null,
        p_media_ref: null,
        p_media_metadata: outboundLocationMetadata(input.location),
        p_initiated_at: input.initiatedAt,
      }),
    );
    if (row === null) throw protocolError();
    return {
      created: booleanValue(row['created']),
      recipientNormalizedPhone: requiredString(row['recipient_normalized_phone']),
      message: parseInternalMessage(row['message_json'], null, input.location),
    };
  }

  async resolveRetryableMessage(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
  }): Promise<WhatsAppMessage | null> {
    const row = oneRow(
      await this.#callOutboundRpc('get_tux_whatsapp_retry_source_v1', {
        p_shop_id: input.shopId,
        p_message_id: input.messageId,
      }),
    );
    if (row === null) return null;
    return parseInternalMessage(row['message_json'], row['media_json'], row['location_json']);
  }

  async claimRetryIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly messageId: string;
    readonly outboundIntentKey: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent> {
    const row = oneRow(
      await this.#callOutboundRpc('claim_tux_whatsapp_retry_intent_v1', {
        p_shop_id: input.shopId,
        p_business_day_id: input.businessDayId,
        p_claimed_worker_id: input.workerId,
        p_device_id: input.deviceId,
        p_failed_message_id: input.messageId,
        p_outbound_intent_key: input.outboundIntentKey,
        p_initiated_at: input.initiatedAt,
      }),
    );
    if (row === null) throw protocolError();
    return {
      created: booleanValue(row['created']),
      recipientNormalizedPhone: requiredString(row['recipient_normalized_phone']),
      message: parseInternalMessage(row['message_json'], row['media_json'], row['location_json']),
    };
  }

  async resolveMediaAccess(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
  }): Promise<WhatsAppMediaAccessRecord | null> {
    const row = oneRow(
      await this.#callOutboundRpc('get_tux_whatsapp_media_access_v1', {
        p_shop_id: input.shopId,
        p_message_id: input.messageId,
      }),
    );
    if (row === null) return null;
    return {
      messageId: requiredString(row['message_id']),
      objectPath: requiredString(row['object_path']),
      expiresAt: requiredString(row['expires_at']),
      deletedAt: nullableString(row['deleted_at']),
    };
  }
}
