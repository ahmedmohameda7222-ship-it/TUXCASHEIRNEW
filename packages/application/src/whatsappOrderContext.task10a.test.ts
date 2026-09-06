import {
  instant,
  parseEntityId,
  type BusinessDayId,
  type ShopId,
  type WhatsAppConversation,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase, WhatsAppStore } from '@tux/persistence';
import { describe, expect, it, vi } from 'vitest';
import { resolveWhatsAppCustomerOrderContext } from './whatsappOrderContext';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const conversationId = '60000000-0000-4000-8000-000000000001';
const at = instant('2026-09-06T08:00:00.000Z');

function conversation(): WhatsAppConversation {
  return {
    id: conversationId,
    shopId,
    normalizedPhone: '+201001234567',
    displayPhone: '01001234567',
    customerName: 'E2E Customer',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: at,
  };
}

describe('Task 10A WhatsApp customer order context phone identity', () => {
  it('preserves canonical normalizedPhone while retaining the local displayPhone', async () => {
    const getByNormalizedPhone = vi.fn().mockResolvedValue(null);
    const database: OperationsDatabase = {
      transaction: async (work) =>
        work({
          customerContacts: { getByNormalizedPhone },
          orders: { listByBusinessDay: vi.fn().mockResolvedValue([]) },
        } as never),
    };
    const store: WhatsAppStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
      upsertMessage: vi.fn().mockResolvedValue(undefined),
      loadInbox: vi.fn().mockResolvedValue({
        conversations: [conversation()],
        messages: [],
        quickReplies: [],
        orderLinks: [],
      }),
      listMessages: vi.fn().mockResolvedValue([]),
      saveDraft: vi.fn().mockResolvedValue(undefined),
      getDraft: vi.fn().mockResolvedValue(null),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const session = {
      getState: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          status: 'ACTIVE',
          shopId,
          businessDayId,
          businessDayStartedAt: at,
          operator: { id: workerId, displayName: 'Worker' },
        },
      }),
    };

    const result = await resolveWhatsAppCustomerOrderContext({
      database,
      store,
      session,
      conversationId,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'NO_ACTIVE_ORDER',
        customer: {
          normalizedPhone: '+201001234567',
          displayPhone: '01001234567',
          customerName: 'E2E Customer',
          address: null,
          zoneId: null,
        },
        activeOrders: [],
      },
    });
    expect(getByNormalizedPhone).toHaveBeenCalledWith(shopId, '01001234567');
  });
});
