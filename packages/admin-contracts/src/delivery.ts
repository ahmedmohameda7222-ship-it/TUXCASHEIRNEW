export type AdminDeliveryZoneBoundary =
  | {
      kind: 'RADIUS';
      latitude: number;
      longitude: number;
      radiusMeters: number;
    }
  | {
      kind: 'POLYGON';
      points: readonly {
        latitude: number;
        longitude: number;
      }[];
    };

export type AdminDeliveryZone = {
  id: string;
  shopId: string;
  name: string;
  feeMinor: number;
  minimumOrderMinor: number;
  priority: number;
  active: boolean;
  boundary: AdminDeliveryZoneBoundary | null;
  fallbackShopId: string | null;
  fallbackEnabled: boolean;
  sortOrder: number;
};

export type AdminDeliveryRiderState = 'AVAILABLE' | 'UNAVAILABLE';

export type AdminDeliveryRider = {
  id: string;
  shopId: string;
  displayName: string;
  phone: string | null;
  active: boolean;
  state: AdminDeliveryRiderState;
};

export type AdminDeliveryOrderState =
  | 'UNASSIGNED'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RETURNED';

export type AdminDeliveryOrder = {
  orderId: string;
  shopId: string;
  riderId: string | null;
  state: AdminDeliveryOrderState;
  version: number;
  updatedAt: string;
};

export type AdminDeliveryStateEvent = {
  id: string;
  orderId: string;
  shopId: string;
  riderId: string | null;
  fromState: AdminDeliveryOrderState | null;
  toState: AdminDeliveryOrderState;
  employeeId: string;
  note: string | null;
  createdAt: string;
};

export type AdminDeliveryWorkspace = {
  shopId: string;
  zones: readonly AdminDeliveryZone[];
  riders: readonly AdminDeliveryRider[];
  orders: readonly AdminDeliveryOrder[];
};

export type DeliveryRouteInput = {
  requestedShopId: string;
  latitude: number;
  longitude: number;
  subtotalMinor: number;
  at: string;
};

export type DeliveryRouteResult =
  | {
      ok: true;
      shopId: string;
      zoneId: string;
      zoneName: string;
      feeMinor: number;
      minimumOrderMinor: number;
      fallbackUsed: boolean;
    }
  | {
      ok: false;
      code:
        | 'delivery_unavailable'
        | 'delivery_closed'
        | 'minimum_order_not_met';
    };

export type AdminDeliveryMutationResult =
  | {
      ok: true;
      orderId: string;
      state: AdminDeliveryOrderState;
      version: number;
      replayed: boolean;
    }
  | { ok: false; code: string };
