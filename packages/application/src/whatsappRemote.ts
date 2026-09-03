import type {
  BusinessDayId,
  Instant,
  OrderId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
  WorkerId,
} from '@tux/domain';

export type WhatsAppRemoteErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'DELIVERY_UNCERTAIN'
  | 'REMOTE_UNAVAILABLE';

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

export interface WhatsAppInboxOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: Instant;
}

export interface WhatsAppInboxSnapshot {
  readonly conversations: readonly WhatsAppConversation[];
  readonly messages: readonly WhatsAppMessage[];
  readonly quickReplies: readonly WhatsAppQuickReply[];
  readonly orderLinks: readonly WhatsAppInboxOrderLink[];
  readonly nextCursor: string | null;
}

export interface WhatsAppRemoteGateway {
  loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot>;

  sendText(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
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
