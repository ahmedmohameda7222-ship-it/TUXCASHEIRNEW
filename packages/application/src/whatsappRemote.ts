import type { CachedWhatsAppInboxSnapshot, CachedWhatsAppOrderLink } from '@tux/persistence';
import type {
  BusinessDayId,
  OrderId,
  WhatsAppMessage,
  WhatsAppMessagingTarget,
  WorkerId,
} from '@tux/domain';

export type WhatsAppRemoteErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'DELIVERY_UNCERTAIN'
  | 'FREE_FORM_WINDOW_CLOSED'
  | 'REMOTE_UNAVAILABLE'
  | 'DEVICE_AUTH_INVALID';

export class WhatsAppRemoteError extends Error {
  constructor(
    readonly code: WhatsAppRemoteErrorCode,
    message: string,
    readonly messageId: string | null = null,
  ) {
    super(message);
    this.name = 'WhatsAppRemoteError';
  }
}

export type WhatsAppInboxOrderLink = CachedWhatsAppOrderLink;

export interface WhatsAppInboxSnapshot extends CachedWhatsAppInboxSnapshot {
  readonly nextCursor: string | null;
}

export interface WhatsAppRemoteGateway {
  loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot>;

  resolveMessagingTarget(input: {
    readonly normalizedPhone: string;
    readonly displayPhone: string;
  }): Promise<WhatsAppMessagingTarget>;

  sendText(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
  }): Promise<WhatsAppMessage>;

  sendTemplate(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly normalizedPhone: string;
    readonly displayPhone: string;
    readonly templateId: string;
    readonly outboundIntentKey: string;
  }): Promise<WhatsAppMessage>;

  markUnread(conversationId: string): Promise<void>;
  archive(conversationId: string, archived?: boolean): Promise<void>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<void>;

  linkOrder(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked?: boolean;
  }): Promise<void>;
}
