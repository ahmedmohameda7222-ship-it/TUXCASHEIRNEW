import type {
  AdminSessionPrincipal,
  WhatsAppAdminCommand,
  WhatsAppAdminCommandResult,
  WhatsAppAdminResponse,
  WhatsAppProviderTemplateState,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export interface WhatsAppAdminReadInput {
  readonly view: WhatsAppAdminResponse['view'];
  readonly shopId: string;
  readonly id: string | null;
  readonly cursor: string | null;
  readonly limit: number;
}

type ConversationSource = {
  readonly id: string;
  readonly displayName: string;
  readonly displayPhone: string;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
  readonly linkedOrderId: string | null;
  readonly customerId?: string | null;
};

type MessageSource = {
  readonly id: string;
  readonly direction: 'INBOUND' | 'OUTBOUND';
  readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'SYSTEM';
  readonly text: string | null;
  readonly status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNCERTAIN';
  readonly senderKind: 'WORKER' | 'SYSTEM' | null;
  readonly workerName: string | null;
  readonly failureCode: string | null;
  readonly createdAt: string;
};

export interface WhatsAppAdminDependencies {
  overview(
    shopId: string,
    businessId: string,
  ): Promise<{
    configured: boolean;
    automationEnabled: boolean;
    health: 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR';
    recentActivityAt: string | null;
    conversations: number;
    failed: number;
    uncertain: number;
    approvedTemplates: number;
  }>;
  conversations(
    shopId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{ rows: readonly ConversationSource[]; nextCursor: string | null }>;
  conversation(
    shopId: string,
    id: string,
  ): Promise<{
    conversation: ConversationSource;
    messages: readonly MessageSource[];
    orderIds: readonly string[];
  } | null>;
  templates(shopId: string): Promise<
    readonly {
      id: string;
      label: string;
      providerTemplateId: string;
      languageCode: string;
      state: WhatsAppProviderTemplateState;
    }[]
  >;
  quickReplies(
    shopId: string,
    businessId: string,
  ): Promise<
    readonly {
      id: string;
      shopId: string | null;
      title: string;
      body: string;
      enabled: boolean;
      sortPosition: number;
      version: number;
    }[]
  >;
  rules(
    shopId: string,
    businessId: string,
  ): Promise<{
    automationEnabled: boolean;
    rows: readonly {
      id: string;
      eventType: 'ORDER_ACCEPTED' | 'DELIVERY_OUT_FOR_DELIVERY' | 'DELIVERY_DELIVERED';
      templateId: string;
      languageCode: string;
      templateState: WhatsAppProviderTemplateState | null;
      enabled: boolean;
      supported: boolean;
      unsupportedReason: string | null;
      version: number;
    }[];
  }>;
  analytics(shopId: string): Promise<{
    available: boolean;
    sent: number | null;
    delivered: number | null;
    read: number | null;
    failed: number | null;
    uncertain: number | null;
    responseTimeMinutes: number | null;
  }>;
  channels(shopId: string): Promise<
    readonly {
      id: string;
      provider: 'META_CLOUD_API';
      maskedBusinessPhone: string | null;
      active: boolean;
    }[]
  >;
  health(
    shopId: string,
    businessId: string,
  ): Promise<{
    configured: boolean;
    state: 'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR';
    lastWebhookAt: string | null;
    lastOutboundAt: string | null;
    lastErrorCode: string | null;
  }>;
  mutate(
    command: WhatsAppAdminCommand,
    principal: AdminSessionPrincipal,
  ): Promise<WhatsAppAdminCommandResult>;
}

function maskPhone(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 7) return '••••';
  return `${normalized.slice(0, 3)}••••••${normalized.slice(-4)}`;
}

function conversation(source: ConversationSource) {
  return {
    id: source.id,
    displayName: source.displayName,
    maskedPhone: maskPhone(source.displayPhone),
    unreadCount: source.unreadCount,
    lastMessageAt: source.lastMessageAt,
    linkedOrderId: source.linkedOrderId,
  };
}

export function createWhatsAppAdminService(deps: WhatsAppAdminDependencies) {
  return {
    async read(
      input: WhatsAppAdminReadInput,
      principal: AdminSessionPrincipal,
    ): Promise<WhatsAppAdminResponse> {
      requirePermission(principal, 'whatsapp.view', input.shopId);
      const canManage = principal.permissions.includes('whatsapp.manage');
      if (input.view === 'overview') {
        const source = await deps.overview(input.shopId, principal.businessId);
        return {
          view: 'overview',
          shopId: input.shopId,
          canManage,
          configured: source.configured,
          automationEnabled: source.automationEnabled,
          health: source.health,
          recentActivityAt: source.recentActivityAt,
          totals: {
            conversations: source.conversations,
            failed: source.failed,
            uncertain: source.uncertain,
            approvedTemplates: source.approvedTemplates,
          },
        };
      }
      if (input.view === 'conversations') {
        const page = await deps.conversations(input.shopId, input.cursor, input.limit);
        return {
          view: 'conversations',
          rows: page.rows.map(conversation),
          nextCursor: page.nextCursor,
        };
      }
      if (input.view === 'conversation') {
        if (!input.id) throw new Error('conversation_id_required');
        const source = await deps.conversation(input.shopId, input.id);
        if (!source) throw new Error('conversation_not_found');
        return {
          view: 'conversation',
          conversation: conversation(source.conversation),
          customerId: source.conversation.customerId ?? null,
          orderIds: source.orderIds,
          messages: source.messages.map((message) => ({
            id: message.id,
            direction: message.direction,
            kind: message.kind,
            text: message.text,
            status: message.status,
            senderKind:
              message.direction === 'INBOUND' ? 'CUSTOMER' : (message.senderKind ?? 'WORKER'),
            author:
              message.direction === 'INBOUND'
                ? 'Customer'
                : message.senderKind === 'SYSTEM'
                  ? 'TUX Automatic'
                  : (message.workerName ?? 'Worker'),
            failureCode: message.failureCode,
            createdAt: message.createdAt,
          })),
        };
      }
      if (input.view === 'templates')
        return { view: 'templates', rows: await deps.templates(input.shopId) };
      if (input.view === 'quick-replies')
        return {
          view: 'quick-replies',
          canManage,
          rows: await deps.quickReplies(input.shopId, principal.businessId),
        };
      if (input.view === 'automatic-messages') {
        const source = await deps.rules(input.shopId, principal.businessId);
        return {
          view: 'automatic-messages',
          canManage,
          automationEnabled: source.automationEnabled,
          rows: source.rows,
        };
      }
      if (input.view === 'analytics')
        return { view: 'analytics', ...(await deps.analytics(input.shopId)) };
      if (input.view === 'channels') {
        const rows = await deps.channels(input.shopId);
        return { view: 'channels', canManage, configured: rows.some((row) => row.active), rows };
      }
      return { view: 'health', ...(await deps.health(input.shopId, principal.businessId)) };
    },

    async mutate(
      command: WhatsAppAdminCommand,
      principal: AdminSessionPrincipal,
    ): Promise<WhatsAppAdminCommandResult> {
      requirePermission(principal, 'whatsapp.manage', command.shopId);
      if (command.type === 'event-rule.set' && command.payload.enabled) {
        const templates = await deps.templates(command.shopId);
        const template = templates.find((candidate) => candidate.id === command.payload.templateId);
        if (!template || template.state !== 'APPROVED')
          return { ok: false, code: 'template_not_approved' };
      }
      return deps.mutate(command, principal);
    },
  };
}

type Row = Readonly<Record<string, unknown>>;
const string = (value: unknown): string => (typeof value === 'string' ? value : '');
const nullable = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;
const integer = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
const boolean = (value: unknown): boolean => value === true;

async function preferences(
  client: AdminSupabaseClient,
  shopId: string,
  businessId: string,
): Promise<Row | null> {
  const rows = await client.select<Row[]>(
    'whatsapp_admin_preferences',
    new URLSearchParams({
      select:
        'automation_enabled,channel_configured,webhook_health,last_webhook_at,last_outbound_at,last_error_code,version',
      business_id: `eq.${businessId}`,
      shop_id: `eq.${shopId}`,
      limit: '1',
    }),
  );
  return rows[0] ?? null;
}

export function createSupabaseWhatsAppAdminDependencies(
  client: AdminSupabaseClient,
): WhatsAppAdminDependencies {
  const listTemplates = async (shopId: string) => {
    const rows = await client.select<Row[]>(
      'whatsapp_starter_templates',
      new URLSearchParams({
        select: 'id,display_label,provider_template_name,language_code,provider_status,active',
        shop_id: `eq.${shopId}`,
        order: 'display_label.asc,id.asc',
      }),
    );
    return rows.map((row) => ({
      id: string(row['id']),
      label: string(row['display_label']),
      providerTemplateId: string(row['provider_template_name']),
      languageCode: string(row['language_code']),
      state: (boolean(row['active'])
        ? string(row['provider_status'])
        : 'DISABLED') as WhatsAppProviderTemplateState,
    }));
  };
  return {
    async overview(shopId, businessId) {
      const [pref, channelRows, conversations, messages, templates, intents] = await Promise.all([
        preferences(client, shopId, businessId),
        client.select<Row[]>(
          'whatsapp_channels',
          new URLSearchParams({
            select: 'id',
            shop_id: `eq.${shopId}`,
            active: 'eq.true',
            limit: '1',
          }),
        ),
        client.select<Row[]>(
          'whatsapp_conversations',
          new URLSearchParams({
            select: 'id,last_message_at',
            shop_id: `eq.${shopId}`,
            order: 'last_message_at.desc.nullslast',
            limit: '500',
          }),
        ),
        client.select<Row[]>(
          'whatsapp_messages',
          new URLSearchParams({
            select: 'status,updated_at',
            shop_id: `eq.${shopId}`,
            status: 'eq.FAILED',
            limit: '500',
          }),
        ),
        listTemplates(shopId),
        client.select<Row[]>(
          'whatsapp_event_send_intents',
          new URLSearchParams({
            select: 'id,status',
            shop_id: `eq.${shopId}`,
            status: 'eq.UNCERTAIN',
            limit: '500',
          }),
        ),
      ]);
      return {
        configured: channelRows.length === 1,
        automationEnabled: boolean(pref?.['automation_enabled']),
        health: (string(pref?.['webhook_health']) || 'UNKNOWN') as
          'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR',
        recentActivityAt: nullable(conversations[0]?.['last_message_at']),
        conversations: conversations.length,
        failed: messages.length,
        uncertain: intents.length,
        approvedTemplates: templates.filter((item) => item.state === 'APPROVED').length,
      };
    },
    async conversations(shopId, cursor, limit) {
      const query = new URLSearchParams({
        select: 'id,display_phone,customer_name,unread_count,last_message_at',
        shop_id: `eq.${shopId}`,
        order: 'last_message_at.desc.nullslast,id.desc',
        limit: String(limit + 1),
      });
      if (cursor) query.set('last_message_at', `lt.${cursor}`);
      const rows = await client.select<Row[]>('whatsapp_conversations', query);
      const page = rows.slice(0, limit);
      return {
        rows: page.map((row) => ({
          id: string(row['id']),
          displayName: nullable(row['customer_name']) ?? 'WhatsApp customer',
          displayPhone: string(row['display_phone']),
          unreadCount: integer(row['unread_count']),
          lastMessageAt: nullable(row['last_message_at']),
          linkedOrderId: null,
        })),
        nextCursor: rows.length > limit ? nullable(page.at(-1)?.['last_message_at']) : null,
      };
    },
    async conversation(shopId, conversationId) {
      const conversations = await client.select<Row[]>(
        'whatsapp_conversations',
        new URLSearchParams({
          select: 'id,display_phone,customer_name,customer_contact_id,unread_count,last_message_at',
          shop_id: `eq.${shopId}`,
          id: `eq.${conversationId}`,
          limit: '1',
        }),
      );
      const source = conversations[0];
      if (!source) return null;
      const [messageRows, links, workers, intents] = await Promise.all([
        client.select<Row[]>(
          'whatsapp_messages',
          new URLSearchParams({
            select:
              'id,direction,kind,text,status,sender_kind,sent_by_worker_id,failure_code,created_at,system_event_intent_id',
            shop_id: `eq.${shopId}`,
            conversation_id: `eq.${conversationId}`,
            order: 'created_at.asc,id.asc',
            limit: '200',
          }),
        ),
        client.select<Row[]>(
          'whatsapp_conversation_order_links',
          new URLSearchParams({
            select: 'order_id',
            shop_id: `eq.${shopId}`,
            conversation_id: `eq.${conversationId}`,
            unlinked_at: 'is.null',
            limit: '50',
          }),
        ),
        client.select<Row[]>(
          'workers',
          new URLSearchParams({ select: 'id,display_name', shop_id: `eq.${shopId}`, limit: '500' }),
        ),
        client.select<Row[]>(
          'whatsapp_event_send_intents',
          new URLSearchParams({ select: 'id,status', shop_id: `eq.${shopId}`, limit: '500' }),
        ),
      ]);
      const workerNames = new Map(
        workers.map((row) => [string(row['id']), string(row['display_name'])]),
      );
      const intentStates = new Map(
        intents.map((row) => [string(row['id']), string(row['status'])]),
      );
      const orderIds = links.map((row) => string(row['order_id']));
      return {
        conversation: {
          id: string(source['id']),
          displayName: nullable(source['customer_name']) ?? 'WhatsApp customer',
          displayPhone: string(source['display_phone']),
          unreadCount: integer(source['unread_count']),
          lastMessageAt: nullable(source['last_message_at']),
          linkedOrderId: orderIds.length === 1 ? orderIds[0]! : null,
          customerId: nullable(source['customer_contact_id']),
        },
        orderIds,
        messages: messageRows.map((row) => {
          const intentStatus = intentStates.get(string(row['system_event_intent_id']));
          return {
            id: string(row['id']),
            direction: string(row['direction']) as MessageSource['direction'],
            kind: string(row['kind']) as MessageSource['kind'],
            text: nullable(row['text']),
            status: (intentStatus === 'UNCERTAIN'
              ? 'UNCERTAIN'
              : string(row['status'])) as MessageSource['status'],
            senderKind: nullable(row['sender_kind']) as MessageSource['senderKind'],
            workerName: workerNames.get(string(row['sent_by_worker_id'])) ?? null,
            failureCode: nullable(row['failure_code']),
            createdAt: string(row['created_at']),
          };
        }),
      };
    },
    templates: listTemplates,
    async quickReplies(shopId, businessId) {
      const rows = await client.select<Row[]>(
        'whatsapp_admin_quick_replies',
        new URLSearchParams({
          select: 'id,shop_id,title,body,enabled,sort_position,version',
          business_id: `eq.${businessId}`,
          or: `(shop_id.is.null,shop_id.eq.${shopId})`,
          order: 'sort_position.asc,id.asc',
        }),
      );
      return rows.map((row) => ({
        id: string(row['id']),
        shopId: nullable(row['shop_id']),
        title: string(row['title']),
        body: string(row['body']),
        enabled: boolean(row['enabled']),
        sortPosition: integer(row['sort_position']),
        version: integer(row['version']),
      }));
    },
    async rules(shopId, businessId) {
      const [pref, rows, templates] = await Promise.all([
        preferences(client, shopId, businessId),
        client.select<Row[]>(
          'whatsapp_event_message_rules',
          new URLSearchParams({
            select:
              'id,event_type,provider_template_id,language_code,enabled,unsupported_reason,version',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'event_type.asc',
          }),
        ),
        listTemplates(shopId),
      ]);
      return {
        automationEnabled: boolean(pref?.['automation_enabled']),
        rows: rows.map((row) => {
          const template = templates.find(
            (item) =>
              item.providerTemplateId === string(row['provider_template_id']) &&
              item.languageCode === string(row['language_code']),
          );
          const eventType = string(row['event_type']) as
            'ORDER_ACCEPTED' | 'DELIVERY_OUT_FOR_DELIVERY' | 'DELIVERY_DELIVERED';
          const supported = eventType === 'ORDER_ACCEPTED';
          return {
            id: string(row['id']),
            eventType,
            templateId: template?.id ?? string(row['provider_template_id']),
            languageCode: string(row['language_code']),
            templateState: template?.state ?? null,
            enabled: boolean(row['enabled']),
            supported,
            unsupportedReason: supported
              ? nullable(row['unsupported_reason'])
              : (nullable(row['unsupported_reason']) ??
                'No canonical delivery event source is available.'),
            version: integer(row['version']),
          };
        }),
      };
    },
    async analytics(shopId) {
      const [messages, intents] = await Promise.all([
        client.select<Row[]>(
          'whatsapp_messages',
          new URLSearchParams({
            select: 'status',
            shop_id: `eq.${shopId}`,
            direction: 'eq.OUTBOUND',
            limit: '1000',
          }),
        ),
        client.select<Row[]>(
          'whatsapp_event_send_intents',
          new URLSearchParams({ select: 'status', shop_id: `eq.${shopId}`, limit: '1000' }),
        ),
      ]);
      const count = (status: string) => messages.filter((row) => row['status'] === status).length;
      return {
        available: messages.length > 0 || intents.length > 0,
        sent: count('SENT'),
        delivered: count('DELIVERED'),
        read: count('READ'),
        failed: count('FAILED'),
        uncertain: intents.filter((row) => row['status'] === 'UNCERTAIN').length,
        responseTimeMinutes: null,
      };
    },
    async channels(shopId) {
      const rows = await client.select<Row[]>(
        'whatsapp_channels',
        new URLSearchParams({
          select: 'id,provider,business_phone_e164,active',
          shop_id: `eq.${shopId}`,
          order: 'created_at.asc,id.asc',
        }),
      );
      return rows.map((row) => ({
        id: string(row['id']),
        provider: 'META_CLOUD_API' as const,
        maskedBusinessPhone: nullable(row['business_phone_e164'])
          ? maskPhone(string(row['business_phone_e164']))
          : null,
        active: boolean(row['active']),
      }));
    },
    async health(shopId, businessId) {
      const [pref, channels] = await Promise.all([
        preferences(client, shopId, businessId),
        client.select<Row[]>(
          'whatsapp_channels',
          new URLSearchParams({
            select: 'id',
            shop_id: `eq.${shopId}`,
            active: 'eq.true',
            limit: '1',
          }),
        ),
      ]);
      return {
        configured: channels.length === 1,
        state: (string(pref?.['webhook_health']) || 'UNKNOWN') as
          'UNKNOWN' | 'HEALTHY' | 'STALE' | 'ERROR',
        lastWebhookAt: nullable(pref?.['last_webhook_at']),
        lastOutboundAt: nullable(pref?.['last_outbound_at']),
        lastErrorCode: nullable(pref?.['last_error_code']),
      };
    },
    async mutate(command, principal) {
      return client.rpc<WhatsAppAdminCommandResult>('manage_admin_whatsapp_v1', {
        p_business_id: principal.businessId,
        p_employee_id: principal.employeeId,
        p_shop_id: command.shopId,
        p_command_id: command.commandId,
        p_expected_version: command.expectedVersion,
        p_command_type: command.type,
        p_payload: command.payload,
      });
    },
  };
}
