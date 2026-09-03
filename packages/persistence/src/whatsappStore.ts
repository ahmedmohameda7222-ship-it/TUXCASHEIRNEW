import type { WhatsAppInboxOrderLink, WhatsAppInboxSnapshot } from '@tux/application';
import type {
  Instant,
  ShopId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';

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
  readonly orderLinks: readonly WhatsAppInboxOrderLink[];
}

export interface WhatsAppStore {
  initialize(): Promise<void>;
  upsertRemoteSnapshot(snapshot: WhatsAppInboxSnapshot): Promise<void>;
  upsertMessage(message: WhatsAppMessage): Promise<void>;
  loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot>;
  listMessages(shopId: ShopId, conversationId: string): Promise<readonly WhatsAppMessage[]>;
  saveDraft(draft: WhatsAppDraft): Promise<void>;
  getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null>;
  close(): Promise<void>;
}

export const whatsappStoreContractVersion = 1 as const;
