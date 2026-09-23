export type DeliveryRoutingBoundary =
  | {
      readonly kind: 'RADIUS';
      readonly latitude: number;
      readonly longitude: number;
      readonly radiusMeters: number;
    }
  | {
      readonly kind: 'POLYGON';
      readonly points: readonly {
        readonly latitude: number;
        readonly longitude: number;
      }[];
    };

export interface DeliveryRoutingZone {
  readonly id: string;
  readonly name: string;
  readonly feeMinor: number;
  readonly minimumOrderMinor: number;
  readonly priority: number;
  readonly active: boolean;
  readonly boundary: DeliveryRoutingBoundary | null;
  readonly fallbackShopId: string | null;
  readonly fallbackEnabled: boolean;
  readonly sortOrder: number;
}

export interface DeliveryRoutingHours {
  readonly dayOfWeek: number;
  readonly opensLocal: string;
  readonly closesLocal: string;
  readonly active: boolean;
}

export interface DeliveryRoutingShop {
  readonly available: boolean;
  readonly hours: readonly DeliveryRoutingHours[];
  readonly zones: readonly DeliveryRoutingZone[];
}

export interface DeliveryRoutingContext {
  readonly requestedShopAvailable: boolean;
  readonly requestedShopHours: readonly DeliveryRoutingHours[];
  readonly zones: readonly DeliveryRoutingZone[];
  readonly fallbackShops: Readonly<Record<string, DeliveryRoutingShop>>;
}

export interface DeliveryRoutingInput {
  readonly requestedShopId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly subtotalMinor: number;
  readonly at: string;
}

export type DeliveryRoutingResult =
  | {
      readonly ok: true;
      readonly shopId: string;
      readonly zoneId: string;
      readonly zoneName: string;
      readonly feeMinor: number;
      readonly minimumOrderMinor: number;
      readonly fallbackUsed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: 'delivery_unavailable' | 'delivery_closed' | 'minimum_order_not_met';
    };

function distanceMeters(
  left: { readonly latitude: number; readonly longitude: number },
  right: { readonly latitude: number; readonly longitude: number },
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
  point: { readonly latitude: number; readonly longitude: number },
  polygon: readonly { readonly latitude: number; readonly longitude: number }[],
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

export function deliveryZoneContains(
  zone: DeliveryRoutingZone,
  point: { readonly latitude: number; readonly longitude: number },
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
  const days: Readonly<Record<string, number>> = {
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

export function isDeliveryRoutingOpen(hours: readonly DeliveryRoutingHours[], at: string): boolean {
  const local = cairoLocalParts(at);
  const previousDay = (local.dayOfWeek + 6) % 7;
  return hours.some((window) => {
    if (!window.active) return false;
    if (window.opensLocal < window.closesLocal) {
      return (
        window.dayOfWeek === local.dayOfWeek &&
        local.time >= window.opensLocal &&
        local.time < window.closesLocal
      );
    }
    return (
      (window.dayOfWeek === local.dayOfWeek && local.time >= window.opensLocal) ||
      (window.dayOfWeek === previousDay && local.time < window.closesLocal)
    );
  });
}

function sortedMatchingZones(
  zones: readonly DeliveryRoutingZone[],
  point: { readonly latitude: number; readonly longitude: number },
): DeliveryRoutingZone[] {
  return [...zones]
    .filter((zone) => deliveryZoneContains(zone, point))
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id),
    );
}

function routeForZone(
  zone: DeliveryRoutingZone,
  shopId: string,
  subtotalMinor: number,
  fallbackUsed: boolean,
): DeliveryRoutingResult {
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

export function resolveDeliveryRouting(
  context: DeliveryRoutingContext,
  input: DeliveryRoutingInput,
): DeliveryRoutingResult {
  const point = { latitude: input.latitude, longitude: input.longitude };
  const matchingPrimaryZones = sortedMatchingZones(context.zones, point);
  const primary = matchingPrimaryZones[0] ?? null;
  const requestedOpen =
    context.requestedShopAvailable && isDeliveryRoutingOpen(context.requestedShopHours, input.at);

  if (primary !== null && requestedOpen) {
    return routeForZone(primary, input.requestedShopId, input.subtotalMinor, false);
  }

  const fallbackIds = [
    ...new Set(
      matchingPrimaryZones
        .filter((zone) => zone.fallbackEnabled && zone.fallbackShopId !== null)
        .map((zone) => zone.fallbackShopId!),
    ),
  ];
  for (const fallbackShopId of fallbackIds) {
    const fallback = context.fallbackShops[fallbackShopId];
    if (
      fallback === undefined ||
      !fallback.available ||
      !isDeliveryRoutingOpen(fallback.hours, input.at)
    ) {
      continue;
    }
    const fallbackZone = sortedMatchingZones(fallback.zones, point)[0] ?? null;
    if (fallbackZone !== null) {
      return routeForZone(fallbackZone, fallbackShopId, input.subtotalMinor, true);
    }
  }

  if (primary !== null && context.requestedShopAvailable && !requestedOpen) {
    return { ok: false, code: 'delivery_closed' };
  }
  return { ok: false, code: 'delivery_unavailable' };
}
