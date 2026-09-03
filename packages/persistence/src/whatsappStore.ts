import type {
  Instant,
  OrderId,
  ShopId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';

export interface CachedWhatsAppOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: Instant;
}

export interface WhatsAppDraft {
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly text: string;
  readonly updatedAt: Instant;
}

export interface CachedWhatsAppInboxSnapshot {
  readonly conversations: readonly WhatsAppConversation[];
  readonly messages: readonly WhatsAppMessage[];
  readonly quickReplies: readonly WhatsAppQuickReply[];
  readonly orderLinks: readonly CachedWhatsAppOrderLink[];
}

export interface WhatsAppStore {
  initialize(): Promise<void>;
  upsertRemoteSnapshot(snapshot: CachedWhatsAppInboxSnapshot): Promise<void>;
  upsertMessage(message: WhatsAppMessage): Promise<void>;
  loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot>;
  listMessages(shopId: ShopId, conversationId: string): Promise<readonly WhatsAppMessage[]>;
  saveDraft(draft: WhatsAppDraft): Promise<void>;
  getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null>;
  close(): Promise<void>;
}

export const whatsappStoreContractVersion = 1 as const;
