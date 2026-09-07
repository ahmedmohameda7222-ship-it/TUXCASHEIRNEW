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
import type { OperationsSessionResult } from './session';
import { resolveWhatsAppCustomerOrderContext } from './whatsappOrderContext';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const otherShopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000002');
const businessDayId = parseEntityId<BusinessDayId>('20000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('30000000-0000-4000-8000-000000000001');
const orderTypeId = parseEntityId<OrderTypeId>('40000000-0000-4000-8000-000000000001');
const zoneId = parseEntityId<DeliveryZoneId>('50000000-0000-4000-8000-000000000001');
const conversationId = '60000000-0000-4000-8000-000000000001';
const at = instant('2026-09-04T08:00:00.000Z');

function active(): OperationsSessionResult {
  return {
    ok: true,
    value: {
      status: 'ACTIVE',
      shopId,
      businessDayId,
      businessDayStartedAt: at,
      operator: { id: workerId, displayName: 'Worker' },
    },
  };
}

function conversation(overrides: Partial<WhatsAppConversation> = {}): WhatsAppConversation {
  return {
    id: conversationId,
    shopId,
    normalizedPhone: '01012345678',
    displayPhone: '+20 10 1234 5678',
    customerName: 'Chat Customer',
    context: 'DIRECT',
    linkedOrderId: null,
    unreadCount: 0,
    archived: false,
    followUp: false,
    lastMessageAt: at,
    ...overrides,
  };
}

function order(input: {
  id: string;
  displayOrderNo: number;
  createdAt?: string;
  status?: OrderSnapshot['status'];
  phone?: string;
  shop?: ShopId;
  delivery?: boolean;
}): OrderSnapshot {
  const delivery = input.delivery ?? true;
  return {
    id: parseEntityId<OrderId>(input.id),
    shopId: input.shop ?? shopId,
    businessDayId,
    displayOrderNo: input.displayOrderNo,
    idempotencyKey: `order-${input.displayOrderNo}`,
    status: input.status ?? 'ACTIVE',
    source: 'POS',
    operatorWorkerId: workerId,
    operatorName: 'Worker',
    createdAt: instant(input.createdAt ?? '2026-09-04T09:00:00.000Z'),
    fulfillment: delivery
      ? {
          orderTypeId,
          orderTypeLabel: 'Delivery',
          behavior: 'DELIVERY',
          delivery: {
            customerContactId: null,
            customerName: 'Order Customer',
            normalizedPhone: input.phone ?? '+201012345678',
            address: 'Order address must not leak',
            zoneId,
            zoneLabel: 'Zone',
            configuredFeeMinor: moneyMinor(0),
            finalFeeMinor: moneyMinor(0),
          },
        }
      : {
          orderTypeId,
          orderTypeLabel: 'Take Away',
          behavior: 'TAKE_AWAY',
          delivery: null,
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

function storeFor(conversations: readonly WhatsAppConversation[]): WhatsAppStore {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    upsertRemoteSnapshot: vi.fn().mockResolvedValue(undefined),
    upsertMessage: vi.fn().mockResolvedValue(undefined),
    loadInbox: vi
      .fn()
      .mockResolvedValue({ conversations, messages: [], quickReplies: [], orderLinks: [] }),
    listMessages: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function databaseFor(input: {
  contact?: CustomerContact | null;
  orders?: readonly OrderSnapshot[];
}): OperationsDatabase {
  return {
    transaction: async (work) =>
      work({
        customerContacts: {
          getByNormalizedPhone: vi.fn().mockResolvedValue(input.contact ?? null),
        },
        orders: {
          listByBusinessDay: vi.fn().mockResolvedValue(input.orders ?? []),
        },
      } as never),
  };
}

const session = { getState: vi.fn(async () => active()) };

function resolve(input: {
  conversations?: readonly WhatsAppConversation[];
  contact?: CustomerContact | null;
  orders?: readonly OrderSnapshot[];
  sessionResult?: OperationsSessionResult;
}) {
  const currentSession = input.sessionResult
    ? { getState: vi.fn(async () => input.sessionResult as OperationsSessionResult) }
    : session;
  return resolveWhatsAppCustomerOrderContext({
    database: databaseFor({
      ...(input.contact === undefined ? {} : { contact: input.contact }),
      ...(input.orders === undefined ? {} : { orders: input.orders }),
    }),
    store: storeFor(input.conversations ?? [conversation()]),
    session: currentSession,
    conversationId,
  });
}

describe('resolveWhatsAppCustomerOrderContext', () => {
  it('uses saved customer data for the normalized chat phone and returns zero active orders', async () => {
    const contact: CustomerContact = {
      id: parseEntityId('70000000-0000-4000-8000-000000000001'),
      shopId,
      normalizedPhone: '01012345678',
      displayPhone: '0101 234 5678',
      name: 'Saved Customer',
      latestAddress: 'Saved Address',
      latestZoneId: zoneId,
      lastOrderAt: at,
    };

    await expect(resolve({ contact })).resolves.toEqual({
      ok: true,
      value: {
        kind: 'NO_ACTIVE_ORDER',
        customer: {
          normalizedPhone: '01012345678',
          displayPhone: '0101 234 5678',
          customerName: 'Saved Customer',
          address: 'Saved Address',
          zoneId,
        },
        activeOrders: [],
      },
    });
  });

  it('returns only the matching ACTIVE delivery order from the current business day', async () => {
    const matching = order({ id: '80000000-0000-4000-8000-000000000001', displayOrderNo: 17 });
    const result = await resolve({
      orders: [
        matching,
        order({ id: '80000000-0000-4000-8000-000000000002', displayOrderNo: 18, status: 'DONE' }),
        order({
          id: '80000000-0000-4000-8000-000000000003',
          displayOrderNo: 19,
          phone: '01112345678',
        }),
        order({ id: '80000000-0000-4000-8000-000000000004', displayOrderNo: 20, delivery: false }),
        order({
          id: '80000000-0000-4000-8000-000000000005',
          displayOrderNo: 21,
          shop: otherShopId,
        }),
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'ONE_ACTIVE_ORDER',
        customer: {
          normalizedPhone: '01012345678',
          displayPhone: '+20 10 1234 5678',
          customerName: 'Chat Customer',
          address: null,
          zoneId: null,
        },
        activeOrders: [
          {
            id: matching.id,
            displayOrderNo: 17,
            status: 'ACTIVE',
            orderTypeLabel: 'Delivery',
            createdAt: matching.createdAt,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('items');
    expect(JSON.stringify(result)).not.toContain('Order address must not leak');
  });

  it('returns every matching active order in deterministic order and never guesses one', async () => {
    const later = order({
      id: '80000000-0000-4000-8000-000000000011',
      displayOrderNo: 12,
      createdAt: '2026-09-04T10:00:00.000Z',
    });
    const earlier = order({
      id: '80000000-0000-4000-8000-000000000012',
      displayOrderNo: 11,
      createdAt: '2026-09-04T09:00:00.000Z',
    });

    const result = await resolve({ orders: [later, earlier] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('MULTIPLE_ACTIVE_ORDERS');
    expect(result.value.activeOrders.map((candidate) => candidate.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });

  it('fences cached conversations to the current local shop', async () => {
    const result = await resolve({ conversations: [conversation({ shopId: otherShopId })] });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });

  it('requires an ACTIVE current session and rejects invalid Egyptian chat phones without matching', async () => {
    const noOperator = await resolve({
      sessionResult: {
        ok: true,
        value: {
          status: 'SIGN_IN_REQUIRED',
          shopId,
          businessDayId,
          businessDayStartedAt: at,
        },
      },
    });
    expect(noOperator).toMatchObject({ ok: false, error: { code: 'CONFLICT_ERROR' } });

    const invalidPhone = await resolve({
      conversations: [conversation({ normalizedPhone: '+491701234567' })],
    });
    expect(invalidPhone).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
  });
});
