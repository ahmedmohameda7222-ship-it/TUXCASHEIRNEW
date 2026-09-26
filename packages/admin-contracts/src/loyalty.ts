export type AdminLoyaltyProgram = {
  businessId: string;
  enabled: boolean;
  earnPointsPer100Minor: number;
  redemptionMinorPerPoint: number;
  minimumRedemptionPoints: number;
  pointExpiryDays: number | null;
  shopIds: readonly string[];
  version: number;
  updatedAt: string;
};

export type AdminLoyaltyLedgerEvent = {
  id: string;
  shopId: string | null;
  orderId: string | null;
  eventType:
    | 'EARN'
    | 'REDEEM'
    | 'MANUAL_ADJUSTMENT'
    | 'EXPIRY'
    | 'CANCEL_COMPENSATION'
    | 'REFUND_COMPENSATION'
    | 'RETURN_COMPENSATION';
  pointsDelta: number;
  monetaryValueMinor: number;
  earnExpiresAt: string | null;
  reason: {
    id: string;
    key: string;
    label: string;
    family: string;
    configurationVersion: number;
  } | null;
  note: string | null;
  sourceEventId: string | null;
  createdAt: string;
};

export type AdminCustomerSegment =
  | 'New'
  | 'Returning'
  | 'VIP'
  | 'Inactive 30 Days'
  | 'Inactive 60 Days'
  | 'Top Spenders'
  | 'Frequent Delivery'
  | 'Loyalty Members';

export type AdminCustomerSummary = {
  id: string;
  normalizedPhone: string;
  displayName: string | null;
  orderCount: number;
  lifetimeSpendMinor: number;
  lastOrderAt: string | null;
  loyaltyBalance: number;
  segments: readonly AdminCustomerSegment[];
};

export type AdminCustomerDetail = AdminCustomerSummary & {
  linkedShops: readonly { shopId: string; shopName: string }[];
  addresses: readonly {
    id: string;
    shopId: string | null;
    address: string;
    deliveryZoneId: string | null;
    lastUsedAt: string | null;
  }[];
  deliveryOrderCount: number;
  loyaltyHistory: readonly AdminLoyaltyLedgerEvent[];
};

export type AdminPromotionKind = 'PERCENT' | 'FIXED' | 'FREE_ITEM';
export type AdminPromotionChannel = 'POS' | 'ONLINE' | 'BOTH';
export type AdminPromotionStackingPolicy = 'ONE_ORDER_LEVEL' | 'ALLOW_CONFIGURED';

export type AdminPromotion = {
  id: string;
  businessId: string;
  name: string;
  active: boolean;
  kind: AdminPromotionKind;
  percentBasisPoints: number | null;
  fixedDiscountMinor: number | null;
  freeProductId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  minimumOrderMinor: number;
  shopIds: readonly string[];
  channel: AdminPromotionChannel;
  productIds: readonly string[];
  categoryIds: readonly string[];
  totalUsageLimit: number | null;
  perCustomerUsageLimit: number | null;
  stackingPolicy: AdminPromotionStackingPolicy;
  version: number;
  updatedAt: string;
};

export type AdminPromotionUpsertInput = Omit<
  AdminPromotion,
  'id' | 'businessId' | 'version' | 'updatedAt'
> & {
  id: string | null;
  expectedVersion: number | null;
};

export type AdminLoyaltyAdjustmentResult =
  | { ok: true; ledgerEventId: string; balance: number; replayed: boolean }
  | { ok: false; code: string };

export type AdminPromotionMutationResult =
  | { ok: true; promotionId: string; version: number; replayed: boolean }
  | { ok: false; code: string };
