import { DomainInvariantError } from './errors';
import type { DeviceId, OrderId, ShopId, WorkerId } from './ids';
import type { Instant } from './time';

export type WhatsAppMessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageKind = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'SYSTEM';
export type WhatsAppConversationContext = 'DIRECT' | 'WEB_REQUEST' | 'ORDER_LINKED';

export interface WhatsAppStarterTemplate {
  readonly id: string;
  readonly label: string;
  readonly languageCode: string;
  readonly previewText: string;
}

export interface WhatsAppShopMessagingConfig {
  readonly storefrontUrl: string;
  readonly storeLocation: null | {
    readonly latitude: number;
    readonly longitude: number;
    readonly label: string | null;
    readonly address: string | null;
  };
}

export type WhatsAppMessagingTarget =
  | {
      readonly mode: 'FREE_FORM';
      readonly conversationId: string;
      readonly freeFormUntil: Instant;
      readonly config: WhatsAppShopMessagingConfig;
    }
  | {
      readonly mode: 'TEMPLATE_ONLY';
      readonly conversationId: string | null;
      readonly normalizedPhone: string;
      readonly displayPhone: string;
      readonly templates: readonly WhatsAppStarterTemplate[];
      readonly config: WhatsAppShopMessagingConfig;
    }
  | {
      readonly mode: 'BLOCKED';
      readonly conversationId: string | null;
      readonly reason: 'NO_APPROVED_TEMPLATE';
      readonly config: WhatsAppShopMessagingConfig;
    };

export interface WhatsAppConversation {
  readonly id: string;
  readonly shopId: ShopId;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string | null;
  readonly context: WhatsAppConversationContext;
  readonly linkedOrderId: OrderId | null;
  readonly unreadCount: number;
  readonly archived: boolean;
  readonly followUp: boolean;
  readonly lastMessageAt: Instant | null;
}

export interface WhatsAppMediaDescriptor {
  readonly mediaKey: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly storedAt: Instant;
  readonly expiresAt: Instant;
  readonly availability: 'AVAILABLE' | 'EXPIRED';
}

export interface WhatsAppLocationPayload {
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string | null;
  readonly address: string | null;
}

export interface WhatsAppMessage {
  readonly id: string;
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly providerMessageId: string | null;
  readonly outboundIntentKey: string | null;
  readonly direction: WhatsAppMessageDirection;
  readonly kind: WhatsAppMessageKind;
  readonly text: string | null;
  readonly mediaRef: string | null;
  readonly media: WhatsAppMediaDescriptor | null;
  readonly location: WhatsAppLocationPayload | null;
  readonly status: WhatsAppMessageStatus;
  readonly sentByWorkerId: WorkerId | null;
  readonly initiatedByDeviceId: DeviceId | null;
  readonly initiatedAt: Instant | null;
  readonly createdAt: Instant;
}

export type WhatsAppQuickReplyCategory =
  'PREPARATION' | 'DELIVERY' | 'ADDRESS' | 'PAYMENT' | 'DELAY' | 'THANKS';

export interface WhatsAppQuickReply {
  readonly id: string;
  readonly shopId: ShopId;
  readonly category: WhatsAppQuickReplyCategory;
  readonly language: 'ar-EG' | 'en';
  readonly text: string;
  readonly usageCount: number;
  readonly active: boolean;
}

export function assertWhatsAppMessageInvariant(message: WhatsAppMessage): void {
  const hasText = message.text !== null && message.text.trim().length > 0;
  if (message.kind === 'TEXT') {
    if (
      !hasText ||
      message.mediaRef !== null ||
      message.media !== null ||
      message.location !== null
    ) {
      throw new DomainInvariantError('WhatsApp text messages require text-only content.');
    }
  } else if (message.kind === 'IMAGE' || message.kind === 'DOCUMENT' || message.kind === 'AUDIO') {
    if (
      message.media === null ||
      message.mediaRef === null ||
      message.mediaRef !== message.media.mediaKey ||
      message.media.kind !== message.kind ||
      message.location !== null
    ) {
      throw new DomainInvariantError(
        'WhatsApp binary messages require one matching safe media descriptor.',
      );
    }
    if (!Number.isSafeInteger(message.media.byteSize) || message.media.byteSize < 0) {
      throw new DomainInvariantError('WhatsApp media byte size is invalid.');
    }
  } else if (message.kind === 'LOCATION') {
    if (message.location === null || message.mediaRef !== null || message.media !== null) {
      throw new DomainInvariantError(
        'WhatsApp location messages require structured location only.',
      );
    }
    if (
      !Number.isFinite(message.location.latitude) ||
      message.location.latitude < -90 ||
      message.location.latitude > 90 ||
      !Number.isFinite(message.location.longitude) ||
      message.location.longitude < -180 ||
      message.location.longitude > 180
    ) {
      throw new DomainInvariantError('WhatsApp location coordinates are invalid.');
    }
  } else if (
    !hasText ||
    message.mediaRef !== null ||
    message.media !== null ||
    message.location !== null
  ) {
    throw new DomainInvariantError('WhatsApp system messages require text-only content.');
  }

  if (message.direction === 'INBOUND') {
    if (
      message.outboundIntentKey !== null ||
      message.sentByWorkerId !== null ||
      message.initiatedByDeviceId !== null ||
      message.initiatedAt !== null
    ) {
      throw new DomainInvariantError(
        'Inbound WhatsApp messages cannot carry outbound attribution.',
      );
    }
    return;
  }

  if (message.outboundIntentKey === null || message.outboundIntentKey.trim().length === 0) {
    throw new DomainInvariantError('Outbound WhatsApp messages require a durable intent key.');
  }

  if (
    message.sentByWorkerId === null ||
    message.initiatedByDeviceId === null ||
    message.initiatedAt === null
  ) {
    throw new DomainInvariantError(
      'Outbound WhatsApp messages require worker, device, and initiation attribution.',
    );
  }
}
