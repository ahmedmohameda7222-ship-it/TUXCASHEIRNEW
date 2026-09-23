import type {
  AdminDeliveryOrder,
  AdminDeliveryRider,
  AdminDeliveryWorkspace,
  AdminDeliveryZone,
} from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../adminAuthService.js';
import { AdminAuthorizationError } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import {
  createDeliveryService,
  type DeliveryHours,
  type DeliveryStore,
} from './deliveryService.js';

const uuidSchema = z.string().uuid();
const boundarySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('RADIUS'),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      radiusMeters: z.number().positive().max(200_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('POLYGON'),
      points: z
        .array(
          z
            .object({
              latitude: z.number().min(-90).max(90),
              longitude: z.number().min(-180).max(180),
            })
            .strict(),
        )
        .min(3)
        .max(500),
    })
    .strict(),
]);

const routeSchema = z.object({
  view: z.literal('route'),
  shopId: uuidSchema,
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  subtotalMinor: z.coerce.number().int().safe().nonnegative(),
  at: z.string().datetime(),
});
const zoneUpsertSchema = z
  .object({
    type: z.literal('delivery.zone.upsert'),
    shopId: uuidSchema,
    zoneId: uuidSchema.nullable(),
    expectedVersion: z.number().int().safe().positive().nullable(),
    name: z.string().trim().min(1).max(160),
    feeMinor: z.number().int().safe().nonnegative(),
    minimumOrderMinor: z.number().int().safe().nonnegative(),
    priority: z.number().int().safe(),
    active: z.boolean(),
    boundary: boundarySchema,
    fallbackShopId: uuidSchema.nullable(),
    fallbackEnabled: z.boolean(),
  })
  .strict();

const riderUpsertSchema = z
  .object({
    type: z.literal('delivery.rider.upsert'),
    shopId: uuidSchema,
    riderId: uuidSchema.nullable(),
    expectedVersion: z.number().int().safe().positive().nullable(),
    displayName: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).nullable(),
    active: z.boolean(),
    state: z.enum(['AVAILABLE', 'UNAVAILABLE']),
  })
  .strict();

const transitionSchema = z
  .object({
    type: z.literal('delivery.transition'),
    shopId: uuidSchema,
    orderId: uuidSchema,
    riderId: uuidSchema.nullable(),
    expectedVersion: z.number().int().safe().positive(),
    toState: z.enum([
      'UNASSIGNED',
      'ASSIGNED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'FAILED',
      'RETURNED',
    ]),
    note: z.string().trim().max(500).nullable(),
    commandId: z.string().trim().min(1).max(160),
  })
  .strict();

type ZoneRow = {
  id: string;
  shop_id: string;
  name: string;
  fee_minor: number | string;
  minimum_order_minor: number | string;
  priority: number | string;
  active: boolean;
  boundary_json: AdminDeliveryZone['boundary'];
  fallback_shop_id: string | null;
  fallback_enabled: boolean;
  sort_order: number | string;
  admin_version: number | string;
};

type RiderRow = {
  id: string;
  shop_id: string;
  display_name: string;
  phone: string | null;
  active: boolean;
  state: AdminDeliveryRider['state'];
  version: number | string;
};

type DeliveryOrderRow = {
  order_id: string;
  shop_id: string;
  rider_id: string | null;
  state: AdminDeliveryOrder['state'];
  version: number | string;
  updated_at: string;
};

type HoursRow = {
  day_of_week: number | string;
  opens_local: string;
  closes_local: string;
  active: boolean;
};

type ShopRow = {
  id: string;
  active: boolean;
  lifecycle_state: string;
  temporary_closed: boolean;
};

function safeInteger(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error('delivery_backend_contract_invalid');
  }
  return parsed;
}

function mapZone(row: ZoneRow): AdminDeliveryZone {
  return {
    id: row.id,
    shopId: row.shop_id,
    name: row.name,
    feeMinor: safeInteger(row.fee_minor),
    minimumOrderMinor: safeInteger(row.minimum_order_minor),
    priority: safeInteger(row.priority),
    active: row.active,
    boundary: row.boundary_json,
    fallbackShopId: row.fallback_shop_id,
    fallbackEnabled: row.fallback_enabled,
    sortOrder: safeInteger(row.sort_order),
    version: safeInteger(row.admin_version),
  };
}

function mapHours(rows: readonly HoursRow[]): DeliveryHours[] {
  return rows.map((row) => ({
    dayOfWeek: safeInteger(row.day_of_week),
    opensLocal: row.opens_local.slice(0, 5),
    closesLocal: row.closes_local.slice(0, 5),
    active: row.active,
  }));
}

function shopAvailable(row: ShopRow | undefined): boolean {
  return Boolean(
    row?.active &&
      row.lifecycle_state !== 'ARCHIVED' &&
      !row.temporary_closed,
  );
}

async function loadZones(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<AdminDeliveryZone[]> {
  const rows = await client.select<ZoneRow[]>(
    'delivery_zones',
    new URLSearchParams({
      select:
        'id,shop_id,name,fee_minor,minimum_order_minor,priority,active,boundary_json,fallback_shop_id,fallback_enabled,sort_order,admin_version',
      shop_id: `eq.${shopId}`,
      order: 'priority.desc,sort_order.asc,id.asc',
    }),
  );
  return rows.map(mapZone);
}

async function loadHours(
  client: AdminSupabaseClient,
  businessId: string,
  shopId: string,
): Promise<DeliveryHours[]> {
  const rows = await client.select<HoursRow[]>(
    'shop_weekly_hours',
    new URLSearchParams({
      select: 'day_of_week,opens_local,closes_local,active',
      business_id: `eq.${businessId}`,
      shop_id: `eq.${shopId}`,
      service_kind: 'eq.DELIVERY',
      order: 'day_of_week.asc,opens_local.asc',
    }),
  );
  return mapHours(rows);
}

async function loadShop(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<ShopRow | undefined> {
  const rows = await client.select<ShopRow[]>(
    'shops',
    new URLSearchParams({
      select: 'id,active,lifecycle_state,temporary_closed',
      id: `eq.${shopId}`,
      limit: '1',
    }),
  );
  return rows[0];
}

export function createDeliveryStore(
  client: AdminSupabaseClient,
): DeliveryStore {
  return {
    async loadWorkspace(input): Promise<AdminDeliveryWorkspace> {
      const [zones, riderRows, orderRows] = await Promise.all([
        loadZones(client, input.shopId),
        client.select<RiderRow[]>(
          'delivery_riders',
          new URLSearchParams({
            select: 'id,shop_id,display_name,phone,active,state,version',
            business_id: `eq.${input.businessId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'display_name.asc,id.asc',
          }),
        ),
        client.select<DeliveryOrderRow[]>(
          'delivery_order_states',
          new URLSearchParams({
            select: 'order_id,shop_id,rider_id,state,version,updated_at',
            business_id: `eq.${input.businessId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'updated_at.desc,order_id.desc',
            limit: '500',
          }),
        ),
      ]);

      return {
        shopId: input.shopId,
        zones,
        riders: riderRows.map((row) => ({
          id: row.id,
          shopId: row.shop_id,
          displayName: row.display_name,
          phone: row.phone,
          active: row.active,
          state: row.state,
          version: safeInteger(row.version),
        })),
        orders: orderRows.map((row) => ({
          orderId: row.order_id,
          shopId: row.shop_id,
          riderId: row.rider_id,
          state: row.state,
          version: safeInteger(row.version),
          updatedAt: row.updated_at,
        })),
      };
    },

    async loadRoutingContext(input) {
      const [requestedShop, requestedHours, zones] = await Promise.all([
        loadShop(client, input.requestedShopId),
        loadHours(client, input.businessId, input.requestedShopId),
        loadZones(client, input.requestedShopId),
      ]);

      const fallbackIds = [
        ...new Set(
          zones
            .filter((zone) => zone.fallbackEnabled && zone.fallbackShopId)
            .map((zone) => zone.fallbackShopId!),
        ),
      ];
      const fallbackShops: Record<
        string,
        {
          available: boolean;
          hours: DeliveryHours[];
          zones: AdminDeliveryZone[];
        }
      > = {};

      await Promise.all(
        fallbackIds.map(async (fallbackShopId) => {
          const membership = await client.select<Array<{ shop_id: string }>>(
            'business_shops',
            new URLSearchParams({
              select: 'shop_id',
              business_id: `eq.${input.businessId}`,
              shop_id: `eq.${fallbackShopId}`,
              limit: '1',
            }),
          );
          if (membership.length !== 1) return;
          const [shop, hours, fallbackZones] = await Promise.all([
            loadShop(client, fallbackShopId),
            loadHours(client, input.businessId, fallbackShopId),
            loadZones(client, fallbackShopId),
          ]);
          fallbackShops[fallbackShopId] = {
            available: shopAvailable(shop),
            hours,
            zones: fallbackZones,
          };
        }),
      );

      return {
        requestedShopAvailable: shopAvailable(requestedShop),
        requestedShopHours: requestedHours,
        zones,
        fallbackShops,
      };
    },

    upsertZone(input) {
      return client.rpc('upsert_admin_delivery_zone_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_zone_id: input.zoneId,
        p_expected_version: input.expectedVersion,
        p_name: input.name,
        p_fee_minor: input.feeMinor,
        p_minimum_order_minor: input.minimumOrderMinor,
        p_priority: input.priority,
        p_active: input.active,
        p_boundary_json: input.boundary,
        p_fallback_shop_id: input.fallbackShopId,
        p_fallback_enabled: input.fallbackEnabled,
      });
    },

    upsertRider(input) {
      return client.rpc('upsert_admin_delivery_rider_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_rider_id: input.riderId,
        p_expected_version: input.expectedVersion,
        p_display_name: input.displayName,
        p_phone: input.phone,
        p_active: input.active,
        p_state: input.state,
      });
    },

    transitionOrder(input) {
      return client.rpc('transition_admin_delivery_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_order_id: input.orderId,
        p_rider_id: input.riderId,
        p_expected_version: input.expectedVersion,
        p_to_state: input.toState,
        p_note: input.note,
        p_command_id: input.commandId,
      });
    },
  };
}

async function loadContext(
  request: AdminRequest,
  client: AdminSupabaseClient,
  csrfRequired: boolean,
): Promise<AdminSessionContext> {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  const context = await loadAdminSession(token, client);
  if (csrfRequired) {
    requireSessionCsrf(
      context,
      firstHeader(request.headers['x-tux-admin-csrf']).trim(),
    );
  }
  return context;
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'invalid_delivery_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (
      error.responseBody.includes('TUX_ADMIN_DELIVERY_PERMISSION_REQUIRED')
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    console.error('Admin delivery database request failed', {
      status: error.status,
    });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin delivery request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export async function handleDeliveryRequest(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const service = createDeliveryService(createDeliveryStore(client));

    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(url.searchParams.get('shopId'));
      const context = await loadContext(request, client, false);
      if (url.searchParams.get('view') === 'route') {
        const input = routeSchema.parse({
          view: 'route',
          shopId,
          latitude: url.searchParams.get('latitude'),
          longitude: url.searchParams.get('longitude'),
          subtotalMinor: url.searchParams.get('subtotalMinor'),
          at: url.searchParams.get('at'),
        });
        sendJson(
          response,
          200,
          await service.routeAddress(
            {
              requestedShopId: input.shopId,
              latitude: input.latitude,
              longitude: input.longitude,
              subtotalMinor: input.subtotalMinor,
              at: input.at,
            },
            context.principal,
          ),
        );
        return;
      }
      sendJson(
        response,
        200,
        await service.loadWorkspace(shopId, context.principal),
      );
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const payload = await readJsonObject(request);
    const type = typeof payload.type === 'string' ? payload.type : '';
    const context = await loadContext(request, client, true);
    const result =
      type === 'delivery.zone.upsert'
        ? await service.upsertZone(
            zoneUpsertSchema.parse(payload),
            context.principal,
          )
        : type === 'delivery.rider.upsert'
          ? await service.upsertRider(
              riderUpsertSchema.parse(payload),
              context.principal,
            )
          : await service.transitionOrder(
              transitionSchema.parse(payload),
              context.principal,
            );
    const status = result.ok
      ? 200
      : result.code.includes('stale') ||
          result.code.includes('conflict') ||
          result.code.includes('transition')
        ? 409
        : result.code.includes('permission') ||
            result.code.includes('forbidden')
          ? 403
          : 400;
    sendJson(response, status, result);
  } catch (error) {
    handleFailure(response, error);
  }
}
