import type {
  AdminCustomerDetail,
  AdminCustomerSummary,
  AdminLoyaltyAdjustmentResult,
  AdminLoyaltyLedgerEvent,
  AdminLoyaltyProgram,
  AdminPromotion,
  AdminPromotionMutationResult,
  AdminPromotionUpsertInput,
  AdminSessionPrincipal,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';
import {
  computeAutomaticSegments,
  type CustomerSegmentPolicy,
} from './loyaltyService.js';

export type CrmCustomerFacts = Omit<AdminCustomerDetail, 'segments'> & {
  readonly segmentPolicy: CustomerSegmentPolicy;
};

export interface CrmStore {
  listCustomerFacts(input: {
    businessId: string;
    shopId: string;
    query: string;
  }): Promise<readonly CrmCustomerFacts[]>;
  getCustomerFacts(input: {
    businessId: string;
    shopId: string;
    customerId: string;
  }): Promise<CrmCustomerFacts | null>;
  getLoyaltyProgram(input: { businessId: string }): Promise<AdminLoyaltyProgram | null>;
  listPromotions(input: { businessId: string }): Promise<readonly AdminPromotion[]>;
  upsertLoyaltyProgram(input: {
    employeeId: string;
    businessId: string;
    shopId: string;
    enabled: boolean;
    earnPointsPer100Minor: number;
    redemptionMinorPerPoint: number;
    minimumRedemptionPoints: number;
    pointExpiryDays: number | null;
    shopIds: readonly string[];
    expectedVersion: number | null;
  }): Promise<{ ok: boolean; version?: number; code?: string }>;
  adjustLoyalty(input: {
    employeeId: string;
    businessId: string;
    shopId: string;
    customerId: string;
    pointsDelta: number;
    reasonCodeId: string;
    note: string | null;
    commandId: string;
  }): Promise<AdminLoyaltyAdjustmentResult>;
  upsertPromotion(input: {
    employeeId: string;
    businessId: string;
    shopId: string;
    promotion: AdminPromotionUpsertInput;
    commandId: string;
  }): Promise<AdminPromotionMutationResult>;
}

function withSegments(
  facts: CrmCustomerFacts,
  now: string,
): AdminCustomerDetail {
  const { segmentPolicy, ...detail } = facts;
  return {
    ...detail,
    segments: computeAutomaticSegments(
      {
        now,
        orderCount: facts.orderCount,
        lifetimeSpendMinor: facts.lifetimeSpendMinor,
        lastOrderAt: facts.lastOrderAt,
        deliveryOrderCount: facts.deliveryOrderCount,
        loyaltyBalance: facts.loyaltyBalance,
      },
      segmentPolicy,
    ),
  };
}

function toSummary(detail: AdminCustomerDetail): AdminCustomerSummary {
  return {
    id: detail.id,
    normalizedPhone: detail.normalizedPhone,
    displayName: detail.displayName,
    orderCount: detail.orderCount,
    lifetimeSpendMinor: detail.lifetimeSpendMinor,
    lastOrderAt: detail.lastOrderAt,
    loyaltyBalance: detail.loyaltyBalance,
    segments: detail.segments,
  };
}

export function createCrmService(store: CrmStore) {
  return {
    async listCustomers(
      input: { shopId: string; query: string; now?: string },
      principal: AdminSessionPrincipal,
    ): Promise<readonly AdminCustomerSummary[]> {
      requirePermission(principal, 'customers.view', input.shopId);
      const now = input.now ?? new Date().toISOString();
      const facts = await store.listCustomerFacts({
        businessId: principal.businessId,
        shopId: input.shopId,
        query: input.query,
      });
      return facts.map((entry) => toSummary(withSegments(entry, now)));
    },

    async getCustomerDetail(
      input: { shopId: string; customerId: string; now?: string },
      principal: AdminSessionPrincipal,
    ): Promise<AdminCustomerDetail | null> {
      requirePermission(principal, 'customers.view', input.shopId);
      const facts = await store.getCustomerFacts({
        businessId: principal.businessId,
        shopId: input.shopId,
        customerId: input.customerId,
      });
      return facts ? withSegments(facts, input.now ?? new Date().toISOString()) : null;
    },

    async getLoyaltyProgram(
      input: { shopId: string },
      principal: AdminSessionPrincipal,
    ): Promise<AdminLoyaltyProgram | null> {
      requirePermission(principal, 'customers.view', input.shopId);
      return store.getLoyaltyProgram({ businessId: principal.businessId });
    },

    async listPromotions(
      input: { shopId: string },
      principal: AdminSessionPrincipal,
    ): Promise<readonly AdminPromotion[]> {
      requirePermission(principal, 'promotions.manage', input.shopId);
      return store.listPromotions({ businessId: principal.businessId });
    },

    async upsertLoyaltyProgram(
      input: {
        shopId: string;
        enabled: boolean;
        earnPointsPer100Minor: number;
        redemptionMinorPerPoint: number;
        minimumRedemptionPoints: number;
        pointExpiryDays: number | null;
        shopIds: readonly string[];
        expectedVersion: number | null;
      },
      principal: AdminSessionPrincipal,
    ) {
      requirePermission(principal, 'loyalty.manage', input.shopId);
      return store.upsertLoyaltyProgram({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    async adjustLoyalty(
      input: {
        shopId: string;
        customerId: string;
        pointsDelta: number;
        reasonCodeId: string;
        note: string | null;
        commandId: string;
      },
      principal: AdminSessionPrincipal,
    ) {
      requirePermission(principal, 'loyalty.manage', input.shopId);
      return store.adjustLoyalty({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    async upsertPromotion(
      input: {
        shopId: string;
        promotion: AdminPromotionUpsertInput;
        commandId: string;
      },
      principal: AdminSessionPrincipal,
    ) {
      requirePermission(principal, 'promotions.manage', input.shopId);
      return store.upsertPromotion({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },
  };
}

export type { AdminLoyaltyLedgerEvent };
