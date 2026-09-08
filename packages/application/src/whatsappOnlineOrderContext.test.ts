import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type CustomerContact,
  type CustomerContactId,
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
import type { OperationsSessionResult } from './session';
import { resolveWhatsAppCustomerOrderContext } from './whatsappOrderContext';

const SHOP_ID = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const DAY_ID = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const WORKER_ID = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const ORDER_ID = parseEntityId<OrderId>('44444444-4444-4444-8444-444444444444');
const ORDER_TYPE_ID = parseEntityId<OrderTypeId>('55555555-5555-4555-8555-555555555555');
const ZONE_ID = parseEntityId<DeliveryZoneId>('66666666-6666-4666-8666-666666666666');
const CONTACT_ID = parseEntityId<CustomerContactId>('77777777-7777-4777-8777-777777777777');
const CONVERSATION_ID = '88888888-8888-4888-8888-888888888888';
const AT = instant('2026-09-08T17:00:00.000Z');
const CANONICAL_PHONE = '01012345678';

const ONLINE_ORDER: OrderSnapshot = {
  id: ORDER_ID,
  shopId: SHOP_ID,
  businessDayId: DAY_ID,
  displayOrderNo: 184,
  idempotencyKey: '99999999-9999-4999-8999-999999999999',
  status: 'ACTIVE',
  lifecycle: { revision: 0, doneAt: null, cancellation: null, returned: null },
  source: 'ONLINE',
  operatorWorkerId: WORKER_ID,
  operatorName: 'Current Worker',
  createdAt: AT,
  fulfillment: {
    orderTypeId: ORDER_TYPE_ID,
    orderTypeLabel: 'Delivery',
    behavior: 'DELIVERY',
    delivery: {
      customerContactId: CONTACT_ID,
      customerName: 'Online Customer',
      normalizedPhone: CANONICAL_PHONE,
      address: 'Nasr City, Cairo',
      zoneId: ZONE_ID,
      zoneLabel: 'Nasr City',
      configuredFeeMinor: moneyMinor(3_000),
      finalFeeMinor: moneyMinor(2_500),
    },
  },
  items: [],
  orderNote: null,
  itemsSubtotalMinor: moneyMinor(19_000),
  discountMinor: moneyMinor(0),
  deliveryFeeMinor: moneyMinor(2_500),
  totalMinor: moneyMinor(21_500),
  payments: [],
};

const CONTACT: CustomerContact = {
  id: CONTACT_ID,
  shopId: SHOP_ID,
  normalizedPhone: CANONICAL_PHONE,
  displayPhone: CANONICAL_PHONE,
  name: 'Online Customer',
  latestAddress: 'Nasr City, Cairo',
  latestZoneId: ZONE_ID,
  lastOrderAt: AT,
};

function activeSession(): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId: SHOP_ID,
      businessDayId: DAY_ID,
      businessDayStartedAt: AT,
      operator: { id: WORKER_ID, displayName: 'Current Worker' },
    },
  };
}

function conversation(phone: string): WhatsAppConversation {
  return {
    id: CONVERSATION_ID,
    shopId: SHOP_ID,
    normalizedPhone: phone,
    displayPhone: phone,
    customerName: 'Meta Customer',
    context: 'DIRECT',
    linkedOrderId: ORDER_ID,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: AT,
  };
}

function store(phone: string): WhatsAppStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
    upsertMessage: vi.fn().mockResolvedValue(undefined),
    loadInbox: vi.fn().mockResolvedValue({
      conversations: [conversation(phone)],
      messages: [],
      quickReplies: [],
      orderLinks: [],
    }),
    listMessages: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const database: OperationsDatabase = {
  transaction: async (work) =>
    work({
      customerContacts: {
        getByNormalizedPhone: vi.fn().mockResolvedValue(CONTACT),
      },
      orders: {
        listByBusinessDay: vi.fn().mockResolvedValue([ONLINE_ORDER]),
      },
    } as never),
};

const META_EQUIVALENTS = [
  CANONICAL_PHONE,
  '+201012345678',
  '00201012345678',
  '201012345678',
] as const;

describe('ONLINE delivery → WhatsApp canonical order context', () => {
  it.each(META_EQUIVALENTS)(
    'resolves Meta phone representation %s to the same canonical customer and ONLINE order',
    async (metaPhone) => {
      const result = await resolveWhatsAppCustomerOrderContext({
        database,
        store: store(metaPhone),
        session: { getState: vi.fn(async () => activeSession()) },
        conversationId: CONVERSATION_ID,
      });

      expect(result).toEqual({
        ok: true,
        value: {
          kind: 'ONE_ACTIVE_ORDER',
          customer: {
            normalizedPhone: CANONICAL_PHONE,
            displayPhone: CANONICAL_PHONE,
            customerName: 'Online Customer',
            address: 'Nasr City, Cairo',
            zoneId: ZONE_ID,
          },
          activeOrders: [
            {
              id: ORDER_ID,
              displayOrderNo: 184,
              status: 'ACTIVE',
              orderTypeLabel: 'Delivery',
              createdAt: AT,
            },
          ],
        },
      });
    },
  );
});
