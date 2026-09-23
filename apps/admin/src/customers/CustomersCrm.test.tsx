import type {
  AdminCustomerDetail,
  AdminLoyaltyProgram,
  AdminPromotion,
} from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CustomerDetailPage } from './CustomerDetailPage';
import { LoyaltyPanel } from './LoyaltyPanel';
import { PromotionEditor } from '../promotions/PromotionEditor';

const shopId = '30000000-0000-4000-8000-000000000001';

const customer: AdminCustomerDetail = {
  id: '40000000-0000-4000-8000-000000000001',
  normalizedPhone: '+201012345678',
  displayName: 'Mona',
  orderCount: 12,
  lifetimeSpendMinor: 150_000,
  lastOrderAt: '2026-09-20T12:00:00.000Z',
  loyaltyBalance: 120,
  deliveryOrderCount: 5,
  segments: ['Returning', 'VIP', 'Top Spenders', 'Frequent Delivery', 'Loyalty Members'],
  linkedShops: [{ shopId, shopName: 'Maadi' }],
  addresses: [
    {
      id: '50000000-0000-4000-8000-000000000001',
      shopId,
      address: 'Road 9, Maadi',
      deliveryZoneId: '60000000-0000-4000-8000-000000000001',
      lastUsedAt: '2026-09-20T12:00:00.000Z',
    },
  ],
  loyaltyHistory: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      shopId,
      orderId: '80000000-0000-4000-8000-000000000001',
      eventType: 'EARN',
      pointsDelta: 20,
      monetaryValueMinor: 0,
      earnExpiresAt: null,
      reason: null,
      note: null,
      sourceEventId: 'order-finalized',
      createdAt: '2026-09-20T12:00:00.000Z',
    },
  ],
};

const program: AdminLoyaltyProgram = {
  businessId: '10000000-0000-4000-8000-000000000001',
  enabled: true,
  earnPointsPer100Minor: 1,
  redemptionMinorPerPoint: 10,
  minimumRedemptionPoints: 50,
  pointExpiryDays: 365,
  shopIds: [shopId],
  version: 3,
  updatedAt: '2026-09-20T12:00:00.000Z',
};

const promotion: AdminPromotion = {
  id: '90000000-0000-4000-8000-000000000001',
  businessId: program.businessId,
  name: 'Lunch 10%',
  active: true,
  kind: 'PERCENT',
  percentBasisPoints: 1000,
  fixedDiscountMinor: null,
  freeProductId: null,
  startsAt: null,
  endsAt: null,
  minimumOrderMinor: 5_000,
  shopIds: [shopId],
  channel: 'BOTH',
  productIds: [],
  categoryIds: [],
  totalUsageLimit: 100,
  perCustomerUsageLimit: 2,
  stackingPolicy: 'ONE_ORDER_LEVEL',
  version: 2,
  updatedAt: '2026-09-20T12:00:00.000Z',
};

describe('Plan 5 CRM and promotion controls', () => {
  it('renders canonical customer identity, history, segments, and merge action', () => {
    const html = renderToStaticMarkup(
      <CustomerDetailPage customer={customer} canMerge onMerge={vi.fn()} />,
    );

    for (const value of [
      'Mona',
      '+201012345678',
      'Maadi',
      'Road 9, Maadi',
      '12 orders',
      'VIP',
      'Top Spenders',
      'Frequent Delivery',
      'Merge customer',
    ]) {
      expect(html).toContain(value);
    }
  });

  it('renders immutable loyalty history and permission-gated manual adjustment controls', () => {
    const html = renderToStaticMarkup(
      <LoyaltyPanel
        customer={customer}
        program={program}
        canManage
        saving={false}
        onAdjust={vi.fn()}
      />,
    );

    for (const value of [
      '120 points',
      'EARN',
      '+20',
      'Minimum redemption',
      '50 points',
      'Point expiry',
      '365 days',
      'Reason code',
      'Adjust points',
    ]) {
      expect(html).toContain(value);
    }
  });

  it('renders the complete promotion contract in the editor', () => {
    const html = renderToStaticMarkup(
      <PromotionEditor
        shopId={shopId}
        promotion={promotion}
        saving={false}
        onCancel={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    for (const value of [
      'PERCENT',
      'FIXED',
      'FREE_ITEM',
      'Minimum order',
      'Start',
      'End',
      'Channel',
      'Product restrictions',
      'Category restrictions',
      'Total usage limit',
      'Per-customer usage limit',
      'Stacking policy',
    ]) {
      expect(html).toContain(value);
    }
  });
});
