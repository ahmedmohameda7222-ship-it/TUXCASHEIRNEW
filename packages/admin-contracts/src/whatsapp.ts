export type WhatsAppAdminView =
  | 'overview'
  | 'conversations'
  | 'conversation'
  | 'templates'
  | 'quick-replies'
  | 'automatic-messages'
  | 'analytics'
  | 'channels'
  | 'health';

export type WhatsAppProviderTemplateState =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISABLED';

export interface WhatsAppAdminOverview {
  readonly view: 'overview';
  readonly shopId: string;
  readonly canManage: boolean;
  readonly configured: boolean;
  readonly automationEnabled: boolean;
  readonly health: 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR';
  readonly recentActivityAt: string | null;
  readonly totals: {
    readonly conversations: number;
    readonly failed: number;
    readonly uncertain: number;
    readonly approvedTemplates: number;
  };
}

export interface WhatsAppAdminConversationSummary {
  readonly id: string;
  readonly displayName: string;
  readonly maskedPhone: string;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
  readonly linkedOrderId: string | null;
}

export interface WhatsAppAdminMessage {
  readonly id: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'SYSTEM';
  readonly text: string | null;
  readonly status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNCERTAIN';
  readonly author: string;
  readonly senderKind: 'CUSTOMER' | 'WORKER' | 'SYSTEM';
  readonly failureCode: string | null;
  readonly createdAt: string;
}

export type WhatsAppAdminResponse =
  | WhatsAppAdminOverview
  | { readonly view: 'conversations'; readonly rows: readonly WhatsAppAdminConversationSummary[]; readonly nextCursor: string | null }
  | { readonly view: 'conversation'; readonly conversation: WhatsAppAdminConversationSummary; readonly messages: readonly WhatsAppAdminMessage[]; readonly customerId: string | null; readonly orderIds: readonly string[] }
  | { readonly view: 'templates'; readonly rows: readonly { id: string; label: string; providerTemplateId: string; languageCode: string; state: WhatsAppProviderTemplateState }[] }
  | { readonly view: 'quick-replies'; readonly canManage: boolean; readonly rows: readonly { id: string; shopId: string | null; title: string; body: string; enabled: boolean; sortPosition: number; version: number }[] }
  | { readonly view: 'automatic-messages'; readonly canManage: boolean; readonly automationEnabled: boolean; readonly rows: readonly { id: string; eventType: 'ORDER_ACCEPTED' | 'DELIVERY_OUT_FOR_DELIVERY' | 'DELIVERY_DELIVERED'; templateId: string; languageCode: string; templateState: WhatsAppProviderTemplateState | null; enabled: boolean; supported: boolean; unsupportedReason: string | null; version: number }[] }
  | { readonly view: 'analytics'; readonly available: boolean; readonly sent: number | null; readonly delivered: number | null; readonly read: number | null; readonly failed: number | null; readonly uncertain: number | null; readonly responseTimeMinutes: number | null }
  | { readonly view: 'channels'; readonly canManage: boolean; readonly configured: boolean; readonly rows: readonly { id: string; provider: 'META_CLOUD_API'; maskedBusinessPhone: string | null; active: boolean }[] }
  | { readonly view: 'health'; readonly configured: boolean; readonly state: 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR'; readonly lastWebhookAt: string | null; readonly lastOutboundAt: string | null; readonly lastErrorCode: string | null };

export type WhatsAppAdminCommand =
  | { readonly type: 'quick-reply.upsert'; readonly shopId: string; readonly commandId: string; readonly expectedVersion: number; readonly payload: { readonly id: string | null; readonly title: string; readonly body: string; readonly sortPosition: number } }
  | { readonly type: 'quick-reply.disable'; readonly shopId: string; readonly commandId: string; readonly expectedVersion: number; readonly payload: { readonly id: string } }
  | { readonly type: 'event-rule.set'; readonly shopId: string; readonly commandId: string; readonly expectedVersion: number; readonly payload: { readonly id: string; readonly templateId: string; readonly languageCode: string; readonly enabled: boolean } }
  | { readonly type: 'channel.assign'; readonly shopId: string; readonly commandId: string; readonly expectedVersion: number; readonly payload: { readonly channelId: string } }
  | { readonly type: 'preferences.update'; readonly shopId: string; readonly commandId: string; readonly expectedVersion: number; readonly payload: { readonly automationEnabled: boolean } };

export interface WhatsAppAdminCommandResult {
  readonly ok: boolean;
  readonly code: string;
  readonly version?: number;
  readonly replayed?: boolean;
}
