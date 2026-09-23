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

function distanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const latitude1 = radians(left.latitude);
  const latitude2 = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function pointInPolygon(
  point: { latitude: number; longitude: number },
  polygon: readonly { latitude: number; longitude: number }[],
): boolean {
  let inside = false;
  for (
    let current = 0, previous = polygon.length - 1;
    current < polygon.length;
    previous = current++
  ) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const crosses =
      a.latitude > point.latitude !== b.latitude > point.latitude &&
      point.longitude <
        ((b.longitude - a.longitude) * (point.latitude - a.latitude)) / (b.latitude - a.latitude) +
          a.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function zoneContains(
  zone: AdminDeliveryZone,
  point: { latitude: number; longitude: number },
): boolean {
  if (!zone.active || zone.boundary === null) return false;
  if (zone.boundary.kind === 'RADIUS') {
    return distanceMeters(point, zone.boundary) <= zone.boundary.radiusMeters;
  }
  return zone.boundary.points.length >= 3 && pointInPolygon(point, zone.boundary.points);
}

function cairoLocalParts(at: string): { dayOfWeek: number; time: string } {
  const instant = new Date(at);
  if (Number.isNaN(instant.valueOf())) throw new Error('invalid_delivery_time');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(instant);
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = parts.find((part) => part.type === 'hour')?.value;
  const minute = parts.find((part) => part.type === 'minute')?.value;
  const days: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  if (weekday === undefined || hour === undefined || minute === undefined) {
    throw new Error('invalid_delivery_time');
  }
  return { dayOfWeek: days[weekday]!, time: `${hour}:${minute}` };
}

export function isDeliveryOpen(hours: readonly DeliveryHours[], at: string): boolean {
  const local = cairoLocalParts(at);
  return hours.some((window) => {
    if (!window.active || window.dayOfWeek !== local.dayOfWeek) return false;
    if (window.opensLocal < window.closesLocal) {
      return local.time >= window.opensLocal && local.time < window.closesLocal;
    }
    return local.time >= window.opensLocal || local.time < window.closesLocal;
  });
}

function selectZone(
  zones: readonly AdminDeliveryZone[],
  point: { latitude: number; longitude: number },
): AdminDeliveryZone | null {
  return (
    [...zones]
      .filter((zone) => zoneContains(zone, point))
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.sortOrder - right.sortOrder ||
          left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

function routeForZone(
  zone: AdminDeliveryZone,
  shopId: string,
  subtotalMinor: number,
  fallbackUsed: boolean,
): DeliveryRouteResult {
  if (subtotalMinor < zone.minimumOrderMinor) {
    return { ok: false, code: 'minimum_order_not_met' };
  }
  return {
    ok: true,
    shopId,
    zoneId: zone.id,
    zoneName: zone.name,
    feeMinor: zone.feeMinor,
    minimumOrderMinor: zone.minimumOrderMinor,
    fallbackUsed,
  };
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
      const point = {
        latitude: input.latitude,
        longitude: input.longitude,
      };
      const primary = selectZone(context.zones, point);
      if (primary && context.requestedShopAvailable) {
        if (!isDeliveryOpen(context.requestedShopHours, input.at)) {
          return { ok: false, code: 'delivery_closed' };
        }
        return routeForZone(primary, input.requestedShopId, input.subtotalMinor, false);
      }

      const fallbackIds = [
        ...new Set(
          context.zones
            .filter((zone) => zoneContains(zone, point))
            .filter((zone) => zone.fallbackEnabled && zone.fallbackShopId)
            .sort((a, b) => b.priority - a.priority)
            .map((zone) => zone.fallbackShopId!),
        ),
      ];
      for (const fallbackShopId of fallbackIds) {
        const fallback = context.fallbackShops[fallbackShopId];
        if (!fallback?.available || !isDeliveryOpen(fallback.hours, input.at)) {
          continue;
        }
        const zone = selectZone(fallback.zones, point);
        if (zone) {
          return routeForZone(zone, fallbackShopId, input.subtotalMinor, true);
        }
      }
      return { ok: false, code: 'delivery_unavailable' };
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
