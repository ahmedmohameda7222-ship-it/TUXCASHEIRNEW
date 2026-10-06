import type {
  AdminDeliveryConfigMutationResult,
  AdminDeliveryMutationResult,
  AdminDeliveryOrder,
  AdminDeliveryOrderState,
  AdminDeliveryRider,
  AdminDeliveryWorkspace,
  AdminDeliveryZone,
  AdminSessionPrincipal,
  DeliveryRouteInput,
  DeliveryRouteResult,
} from '@tux/admin-contracts';

import { deliveryZoneContains, isDeliveryRoutingOpen, resolveDeliveryRouting } from '@tux/domain';

import { requirePermission } from '../authorization.js';

export type DeliveryHours = {
  readonly dayOfWeek: number;
  readonly opensLocal: string;
  readonly closesLocal: string;
  readonly active: boolean;
};

export interface DeliveryStore {
  loadWorkspace(input: { businessId: string; shopId: string }): Promise<AdminDeliveryWorkspace>;
  loadRoutingContext(input: { businessId: string; requestedShopId: string }): Promise<{
    requestedShopAvailable: boolean;
    requestedShopHours: readonly DeliveryHours[];
    zones: readonly AdminDeliveryZone[];
    fallbackShops: Readonly<
      Record<
        string,
        {
          available: boolean;
          hours: readonly DeliveryHours[];
          zones: readonly AdminDeliveryZone[];
        }
      >
    >;
  }>;
  upsertZone(input: {
    businessId: string;
    employeeId: string;
    shopId: string;
    zoneId: string | null;
    expectedVersion: number | null;
    name: string;
    feeMinor: number;
    minimumOrderMinor: number;
    priority: number;
    active: boolean;
    boundary: AdminDeliveryZone['boundary'];
    fallbackShopId: string | null;
    fallbackEnabled: boolean;
  }): Promise<AdminDeliveryConfigMutationResult>;
  upsertRider(input: {
    businessId: string;
    employeeId: string;
    shopId: string;
    riderId: string | null;
    expectedVersion: number | null;
    displayName: string;
    phone: string | null;
    active: boolean;
    state: AdminDeliveryRider['state'];
  }): Promise<AdminDeliveryConfigMutationResult>;
  transitionOrder(input: {
    businessId: string;
    employeeId: string;
    shopId: string;
    orderId: string;
    riderId: string | null;
    expectedVersion: number;
    toState: AdminDeliveryOrderState;
    note: string | null;
    commandId: string;
  }): Promise<AdminDeliveryMutationResult>;
}

export function zoneContains(
  zone: AdminDeliveryZone,
  point: { latitude: number; longitude: number },
): boolean {
  return deliveryZoneContains(zone, point);
}

export function isDeliveryOpen(hours: readonly DeliveryHours[], at: string): boolean {
  return isDeliveryRoutingOpen(hours, at);
}

export function createDeliveryService(store: DeliveryStore) {
  return {
    loadWorkspace(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<AdminDeliveryWorkspace> {
      requirePermission(principal, 'delivery.view', shopId);
      return store.loadWorkspace({
        businessId: principal.businessId,
        shopId,
      });
    },

    async routeAddress(
      input: DeliveryRouteInput,
      principal: AdminSessionPrincipal,
    ): Promise<DeliveryRouteResult> {
      requirePermission(principal, 'delivery.view', input.requestedShopId);
      const context = await store.loadRoutingContext({
        businessId: principal.businessId,
        requestedShopId: input.requestedShopId,
      });
      return resolveDeliveryRouting(context, input);
    },

    upsertZone(
      input: {
        shopId: string;
        zoneId: string | null;
        expectedVersion: number | null;
        name: string;
        feeMinor: number;
        minimumOrderMinor: number;
        priority: number;
        active: boolean;
        boundary: AdminDeliveryZone['boundary'];
        fallbackShopId: string | null;
        fallbackEnabled: boolean;
      },
      principal: AdminSessionPrincipal,
    ): Promise<AdminDeliveryConfigMutationResult> {
      requirePermission(principal, 'delivery.manage', input.shopId);
      return store.upsertZone({
        ...input,
        businessId: principal.businessId,
        employeeId: principal.employeeId,
      });
    },

    upsertRider(
      input: {
        shopId: string;
        riderId: string | null;
        expectedVersion: number | null;
        displayName: string;
        phone: string | null;
        active: boolean;
        state: AdminDeliveryRider['state'];
      },
      principal: AdminSessionPrincipal,
    ): Promise<AdminDeliveryConfigMutationResult> {
      requirePermission(principal, 'delivery.manage', input.shopId);
      return store.upsertRider({
        ...input,
        businessId: principal.businessId,
        employeeId: principal.employeeId,
      });
    },

    transitionOrder(
      input: {
        shopId: string;
        orderId: string;
        riderId: string | null;
        expectedVersion: number;
        toState: AdminDeliveryOrderState;
        note: string | null;
        commandId: string;
      },
      principal: AdminSessionPrincipal,
    ): Promise<AdminDeliveryMutationResult> {
      requirePermission(principal, 'delivery.manage', input.shopId);
      return store.transitionOrder({
        ...input,
        businessId: principal.businessId,
        employeeId: principal.employeeId,
      });
    },
  };
}

export function allowedDeliveryTransition(
  current: AdminDeliveryOrderState,
  next: AdminDeliveryOrderState,
): boolean {
  const allowed: Readonly<Record<AdminDeliveryOrderState, readonly AdminDeliveryOrderState[]>> = {
    UNASSIGNED: ['ASSIGNED'],
    ASSIGNED: ['OUT_FOR_DELIVERY', 'UNASSIGNED'],
    OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED', 'RETURNED'],
    DELIVERED: [],
    FAILED: [],
    RETURNED: [],
  };
  return allowed[current].includes(next);
}

export function riderCanBeAssigned(rider: Pick<AdminDeliveryRider, 'active' | 'state'>): boolean {
  return rider.active && rider.state === 'AVAILABLE';
}

export type { AdminDeliveryOrder };
