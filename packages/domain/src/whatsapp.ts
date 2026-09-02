import { DomainInvariantError } from './errors';
import type { DeviceId, OrderId, ShopId, WorkerId } from './ids';
import type { Instant } from './time';

export type WhatsAppMessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageKind =
  | 'TEXT'
  | 'IMAGE'
  | 'DOCUMENT'
  | 'AUDIO'
  | 'LOCATION'
  | 'SYSTEM';
export type WhatsAppConversationContext = 'DIRECT' | 'WEB_REQUEST' | 'ORDER_LINKED';

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
  readonly status: WhatsAppMessageStatus;
  readonly sentByWorkerId: WorkerId | null;
  readonly initiatedByDeviceId: DeviceId | null;
  readonly initiatedAt: Instant | null;
  readonly createdAt: Instant;
}

export type WhatsAppQuickReplyCategory =
  | 'PREPARATION'
  | 'DELIVERY'
  | 'ADDRESS'
  | 'PAYMENT'
  | 'DELAY'
  | 'THANKS';

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
  if (message.direction === 'INBOUND') {
    if (
      message.outboundIntentKey !== null ||
      message.sentByWorkerId !== null ||
      message.initiatedByDeviceId !== null ||
      message.initiatedAt !== null
    ) {
      throw new DomainInvariantError('Inbound WhatsApp messages cannot carry outbound attribution.');
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
