import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type CustomerContact,
  type DeliveryZoneId,
  type OrderId,
  type OrderSnapshot,
  type OrderTypeId,
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
const orderTypeId = parseEntityId<OrderTypeId>('40000000-0000-4000-8000-000000000001');
const zoneId = parseEntityId<DeliveryZoneId>('50000000-0000-4000-8000-000000000001');
const conversationId = '60000000-0000-4000-8000-000000000001';
const contactId = parseEntityId('70000000-0000-4000-8000-000000000001');
const orderId = parseEntityId<OrderId>('80000000-0000-4000-8000-000000000001');
const at = instant('2026-09-08T00:00:00.000Z');
const canonicalPhone = '01001234567';

const equivalentPhoneForms = [
  '01001234567',
  '+201001234567',
  '00201001234567',
  '201001234567',
] as const;

function conversation(phone: string): WhatsAppConversation {
  return {
    id: conversationId,
    shopId,
    normalizedPhone: phone,
    displayPhone: '+201001234567',
    customerName: 'Chat Customer',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: at,
  };
}

const contact: CustomerContact = {
  id: contactId,
  shopId,
  normalizedPhone: canonicalPhone,
  displayPhone: '0100 123 4567',
  name: 'Saved Customer',
  latestAddress: 'Saved Address',
  latestZoneId: zoneId,
  lastOrderAt: at,
};

function activeDeliveryOrder(phone: string): OrderSnapshot {
  return {
    id: orderId,
    shopId,
    businessDayId,
    displayOrderNo: 42,
    idempotencyKey: 'phone-regression-order',
    status: 'ACTIVE',
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Worker',
    createdAt: at,
    fulfillment: {
      orderTypeId,
      orderTypeLabel: 'Delivery',
      behavior: 'DELIVERY',
      delivery: {
        customerContactId: contactId,
        customerName: 'Saved Customer',
        normalizedPhone: phone,
        address: 'Saved Address',
        zoneId,
        zoneLabel: 'Zone',
        configuredFeeMinor: moneyMinor(0),
        finalFeeMinor: moneyMinor(0),
      },
    },
    items: [],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(0),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor: moneyMinor(0),
    payments: [],
  };
}

function databaseFor(orderPhone: string): OperationsDatabase {
  return {
    transaction: async (work) =>
      work({
        customerContacts: {
          getByNormalizedPhone: async (candidateShopId: ShopId, normalizedPhone: string) =>
            candidateShopId === shopId && normalizedPhone === contact.normalizedPhone ? contact : null,
        },
        orders: {
          listByBusinessDay: async () => [activeDeliveryOrder(orderPhone)],
        },
      } as never),
  };
}

function storeFor(phone: string): WhatsAppStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
    upsertMessage: vi.fn().mockResolvedValue(undefined),
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [conversation(phone)],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    listMessages: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

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

describe('WhatsApp customer phone identity regression', () => {
  it.each(equivalentPhoneForms)(
    'converges equivalent chat form %s on the existing contact and active order identity',
    async (chatPhone) => {
      const result = await resolveWhatsAppCustomerOrderContext({
        database: databaseFor('00201001234567'),
        store: storeFor(chatPhone),
        session,
        conversationId,
      });

      expect(result).toEqual({
        ok: true,
        value: {
          kind: 'ONE_ACTIVE_ORDER',
          customer: {
            normalizedPhone: canonicalPhone,
            displayPhone: contact.displayPhone,
            customerName: contact.name,
            address: contact.latestAddress,
            zoneId,
          },
          activeOrders: [
            {
              id: orderId,
              displayOrderNo: 42,
              status: 'ACTIVE',
              orderTypeLabel: 'Delivery',
              createdAt: at,
            },
          ],
        },
      });
    },
  );

  it('keeps invalid Egyptian-phone rejection intact', async () => {
    const result = await resolveWhatsAppCustomerOrderContext({
      database: databaseFor(canonicalPhone),
      store: storeFor('+491701234567'),
      session,
      conversationId,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
