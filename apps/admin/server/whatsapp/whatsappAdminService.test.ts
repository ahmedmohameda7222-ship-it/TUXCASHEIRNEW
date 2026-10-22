import type { AdminSessionPrincipal, WhatsAppAdminCommand } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  createWhatsAppAdminService,
  createSupabaseWhatsAppAdminDependencies,
  type WhatsAppAdminDependencies,
} from './whatsappAdminService';
import type { AdminSupabaseClient } from '../supabaseAdmin';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER_SHOP = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE = '33333333-3333-4333-8333-333333333333';

function principal(permissions: AdminSessionPrincipal['permissions']): AdminSessionPrincipal {
  return { employeeId: EMPLOYEE, businessId: '44444444-4442-4444-8444-444444444444', role: 'MANAGER', permissions, shopIds: [SHOP] };
}

function dependencies(overrides: Partial<WhatsAppAdminDependencies> = {}): WhatsAppAdminDependencies {
  return {
    overview: vi.fn(async () => ({ configured: false, automationEnabled: false, health: 'UNKNOWN', recentActivityAt: null, conversations: 0, failed: 0, uncertain: 0, approvedTemplates: 0 } as const)),
    conversations: vi.fn(async () => ({ rows: [], nextCursor: null })),
    conversation: vi.fn(async () => null),
    templates: vi.fn(async () => []),
    quickReplies: vi.fn(async () => []),
    rules: vi.fn(async () => ({ automationEnabled: false, rows: [] })),
    analytics: vi.fn(async () => ({ available: false, sent: null, delivered: null, read: null, failed: null, uncertain: null, responseTimeMinutes: null })),
    channels: vi.fn(async () => []),
    health: vi.fn(async () => ({ configured: false, state: 'UNKNOWN', lastWebhookAt: null, lastOutboundAt: null, lastErrorCode: null } as const)),
    mutate: vi.fn(async () => ({ ok: true, code: 'updated', version: 2 })),
    ...overrides,
  };
}

describe('whatsappAdminService', () => {
  it('reports a missing channel honestly without inferred health', async () => {
    const service = createWhatsAppAdminService(dependencies());
    await expect(service.read({ view: 'overview', shopId: SHOP, id: null, cursor: null, limit: 20 }, principal(['whatsapp.view']))).resolves.toMatchObject({ view: 'overview', configured: false, health: 'UNKNOWN', canManage: false, totals: { conversations: 0 } });
  });

  it('allows view-only reads but denies configuration and wrong-shop access', async () => {
    const deps = dependencies();
    const service = createWhatsAppAdminService(deps);
    await service.read({ view: 'channels', shopId: SHOP, id: null, cursor: null, limit: 20 }, principal(['whatsapp.view']));
    const command: WhatsAppAdminCommand = { type: 'preferences.update', shopId: SHOP, commandId: 'command-1', expectedVersion: 1, payload: { automationEnabled: true } };
    await expect(service.mutate(command, principal(['whatsapp.view']))).rejects.toMatchObject({ code: 'permission_forbidden' });
    await expect(service.read({ view: 'overview', shopId: OTHER_SHOP, id: null, cursor: null, limit: 20 }, principal(['whatsapp.view']))).rejects.toMatchObject({ code: 'shop_forbidden' });
    expect(deps.mutate).not.toHaveBeenCalled();
  });

  it('denies callers without whatsapp.view before touching storage', async () => {
    const deps = dependencies();
    const service = createWhatsAppAdminService(deps);
    await expect(service.read({ view: 'overview', shopId: SHOP, id: null, cursor: null, limit: 20 }, principal([]))).rejects.toMatchObject({ code: 'permission_forbidden' });
    expect(deps.overview).not.toHaveBeenCalled();
  });

  it('masks contacts and preserves immutable worker/system attribution', async () => {
    const deps = dependencies({
      conversation: vi.fn(async () => ({
        conversation: { id: 'c1', displayName: 'Customer', displayPhone: '+201012345678', unreadCount: 1, lastMessageAt: '2026-10-22T10:00:00Z', linkedOrderId: 'o1', customerId: 'customer-1' },
        orderIds: ['o1'],
        messages: [
          { id: 'm1', direction: 'OUTBOUND', kind: 'TEXT', text: '<b>literal</b>', status: 'SENT', senderKind: 'WORKER', workerName: 'Mona', failureCode: null, createdAt: '2026-10-22T10:00:00Z' },
          { id: 'm2', direction: 'OUTBOUND', kind: 'TEXT', text: 'Automatic', status: 'UNCERTAIN', senderKind: 'SYSTEM', workerName: null, failureCode: 'provider_timeout', createdAt: '2026-10-22T10:01:00Z' },
        ],
      } as const)),
    });
    const result = await createWhatsAppAdminService(deps).read({ view: 'conversation', shopId: SHOP, id: 'c1', cursor: null, limit: 20 }, principal(['whatsapp.view']));
    expect(result).toMatchObject({ conversation: { maskedPhone: '+20••••••5678' }, messages: [{ author: 'Mona', senderKind: 'WORKER', text: '<b>literal</b>' }, { author: 'TUX Automatic', senderKind: 'SYSTEM', status: 'UNCERTAIN' }] });
  });

  it('refuses enabling automation with a non-approved template', async () => {
    const deps = dependencies({
      templates: vi.fn(async () => [{ id: 'template-1', label: 'Accepted', providerTemplateId: 'accepted', languageCode: 'ar_EG', state: 'PENDING' }] as const),
    });
    const command: WhatsAppAdminCommand = { type: 'event-rule.set', shopId: SHOP, commandId: 'command-2', expectedVersion: 1, payload: { id: 'rule-1', templateId: 'template-1', languageCode: 'ar_EG', enabled: true } };
    await expect(createWhatsAppAdminService(deps).mutate(command, principal(['whatsapp.view', 'whatsapp.manage']))).resolves.toEqual({ ok: false, code: 'template_not_approved' });
    expect(deps.mutate).not.toHaveBeenCalled();
  });

  it('passes CAS results through without returning provider credentials', async () => {
    const mutate = vi.fn(async () => ({ ok: false, code: 'stale_version' }));
    const service = createWhatsAppAdminService(dependencies({ mutate }));
    const command: WhatsAppAdminCommand = { type: 'quick-reply.disable', shopId: SHOP, commandId: 'command-3', expectedVersion: 4, payload: { id: 'reply-1' } };
    await expect(service.mutate(command, principal(['whatsapp.view', 'whatsapp.manage']))).resolves.toEqual({ ok: false, code: 'stale_version' });
    expect(JSON.stringify(await service.read({ view: 'channels', shopId: SHOP, id: null, cursor: null, limit: 20 }, principal(['whatsapp.view', 'whatsapp.manage'])))).not.toMatch(/token|secret|credential/i);
  });

  it('does not invent a provider state when a configured template is unavailable', async () => {
    const client = {
      select: vi.fn(async (table: string) => {
        if (table === 'whatsapp_admin_preferences') return [{ automation_enabled: false }];
        if (table === 'whatsapp_event_message_rules') return [{ id: 'rule-1', event_type: 'ORDER_ACCEPTED', provider_template_id: 'missing', language_code: 'ar_EG', enabled: false, unsupported_reason: null, version: 1 }];
        if (table === 'whatsapp_starter_templates') return [];
        throw new Error(`unexpected_table:${table}`);
      }),
    } as unknown as AdminSupabaseClient;
    const result = await createSupabaseWhatsAppAdminDependencies(client).rules(SHOP, principal([]).businessId);
    expect(result.rows[0]).toMatchObject({ templateState: null, enabled: false });
  });
});
