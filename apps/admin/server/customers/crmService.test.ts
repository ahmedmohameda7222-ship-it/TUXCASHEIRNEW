import { describe, expect, it, vi } from 'vitest';

import type {
  AdminCustomerDetail,
  AdminLoyaltyProgram,
  AdminPromotion,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';

import { createCrmService, type CrmCustomerFacts, type CrmStore } from './crmService';

const businessId = '10000000-0000-4000-8000-000000000001';
const employeeId = '20000000-0000-4000-8000-000000000001';
const shopId = '30000000-0000-4000-8000-000000000001';
const customerId = '40000000-0000-4000-8000-000000000001';

function principal(
  permissions: AdminSessionPrincipal['permissions'] = [
    'customers.view',
    'loyalty.manage',
    'promotions.manage',
  ],
): AdminSessionPrincipal {
  return {
    employeeId,
    businessId,
    role: 'OWNER',
    permissions,
    shopIds: [shopId],
  };
}

const facts: CrmCustomerFacts = {
  id: customerId,
  normalizedPhone: '+201012345678',
  displayName: 'Mona',
  orderCount: 12,
  lifetimeSpendMinor: 150_000,
  lastOrderAt: '2026-07-20T00:00:00.000Z',
  deliveryOrderCount: 5,
  loyaltyBalance: 120,
  linkedShops: [{ shopId, shopName: 'Maadi' }],
  addresses: [],
  loyaltyHistory: [],
  segmentPolicy: {
    vipMinOrders: 10,
    vipMinSpendMinor: 100_000,
    topSpenderMinSpendMinor: 120_000,
    frequentDeliveryMinOrders: 4,
  },
};

function storeFixture(): CrmStore {
  return {
    listCustomerFacts: vi.fn(async () => [facts]),
    getCustomerFacts: vi.fn(async () => facts),
    getLoyaltyProgram: vi.fn(async () => null),
    listPromotions: vi.fn(async () => []),
    upsertLoyaltyProgram: vi.fn(async () => ({ ok: true, version: 1 })),
    adjustLoyalty: vi.fn(async () => ({
      ok: true as const,
      ledgerEventId: '50000000-0000-4000-8000-000000000001',
      balance: 130,
      replayed: false,
    })),
    upsertPromotion: vi.fn(async () => ({
      ok: true as const,
      promotionId: '60000000-0000-4000-8000-000000000001',
      version: 1,
      replayed: false,
    })),
  };
}

describe('CRM service', () => {
  it('derives automatic segments from trusted customer facts', async () => {
    const store = storeFixture();
    const service = createCrmService(store);

    const detail = await service.getCustomerDetail(
      { shopId, customerId, now: '2026-09-23T00:00:00.000Z' },
      principal(['customers.view']),
    );

    expect(detail).toMatchObject<Partial<AdminCustomerDetail>>({
      id: customerId,
      normalizedPhone: '+201012345678',
      segments: [
        'Returning',
        'VIP',
        'Inactive 30 Days',
        'Inactive 60 Days',
        'Top Spenders',
        'Frequent Delivery',
        'Loyalty Members',
      ],
    });
  });

  it('enforces customers, loyalty, and promotion permissions at the service boundary', async () => {
    const store = storeFixture();
    const service = createCrmService(store);

    await expect(service.listCustomers({ shopId, query: '' }, principal([]))).rejects.toThrow(
      /permission_forbidden/,
    );

    await expect(
      service.upsertLoyaltyProgram(
        {
          shopId,
          enabled: true,
          earnPointsPer100Minor: 1,
          redemptionMinorPerPoint: 10,
          minimumRedemptionPoints: 10,
          pointExpiryDays: null,
          shopIds: [shopId],
          expectedVersion: null,
        },
        principal(['customers.view']),
      ),
    ).rejects.toThrow(/permission_forbidden/);

    await expect(service.listPromotions({ shopId }, principal(['customers.view']))).rejects.toThrow(
      /permission_forbidden/,
    );
  });

  it('passes only trusted principal identity into loyalty and promotion mutations', async () => {
    const store = storeFixture();
    const service = createCrmService(store);

    await service.adjustLoyalty(
      {
        shopId,
        customerId,
        pointsDelta: 10,
        reasonCodeId: '70000000-0000-4000-8000-000000000001',
        note: 'Recovery credit',
        commandId: 'adjust-1',
      },
      principal(),
    );

    expect(store.adjustLoyalty).toHaveBeenCalledWith({
      businessId,
      employeeId,
      shopId,
      customerId,
      pointsDelta: 10,
      reasonCodeId: '70000000-0000-4000-8000-000000000001',
      note: 'Recovery credit',
      commandId: 'adjust-1',
    });

    const promotion: Omit<AdminPromotion, 'id' | 'businessId' | 'version' | 'updatedAt'> = {
      name: 'Lunch 10%',
      active: true,
      kind: 'PERCENT',
      percentBasisPoints: 1000,
      fixedDiscountMinor: null,
      freeProductId: null,
      startsAt: null,
      endsAt: null,
      minimumOrderMinor: 0,
      shopIds: [shopId],
      channel: 'BOTH',
      productIds: [],
      categoryIds: [],
      totalUsageLimit: null,
      perCustomerUsageLimit: null,
      stackingPolicy: 'ONE_ORDER_LEVEL',
    };
    await service.upsertPromotion(
      {
        shopId,
        promotion: { ...promotion, id: null, expectedVersion: null },
        commandId: 'promotion-1',
      },
      principal(),
    );
    expect(store.upsertPromotion).toHaveBeenCalledWith(
      expect.objectContaining({ employeeId, businessId, shopId, commandId: 'promotion-1' }),
    );
  });
});
