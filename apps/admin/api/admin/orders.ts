import type {
  AdminOrderCancellationResult,
  AdminOrderDetail,
  AdminOrderFinancialMutationResult,
  AdminOrderSearchResult,
  AdminOrderStatus,
} from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { createOrderService, type OrderStore } from '../../server/orders/orderService.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const commandIdSchema = z.string().trim().min(1).max(160);
const noteSchema = z.string().trim().max(500).nullable();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('order.cancel'),
      shopId: uuidSchema,
      orderId: uuidSchema,
      expectedOperationalRevision: z.number().int().nonnegative(),
      reasonCodeId: uuidSchema,
      note: noteSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('order.refund'),
      shopId: uuidSchema,
      orderId: uuidSchema,
      paymentId: uuidSchema,
      amountMinor: z.number().int().safe().positive(),
      reasonCodeId: uuidSchema,
      note: noteSchema,
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('order.return'),
      shopId: uuidSchema,
      orderId: uuidSchema,
      items: z
        .array(
          z
            .object({
              orderItemId: uuidSchema,
              quantity: z.number().int().safe().positive(),
            })
            .strict(),
        )
        .min(1)
        .max(500),
      reasonCodeId: uuidSchema,
      note: noteSchema,
      commandId: commandIdSchema,
    })
    .strict(),
]);

type OrderRow = {
  id: string;
  shop_id: string;
  status: AdminOrderStatus;
  operational_revision: number | string;
  source: 'POS' | 'ONLINE';
  display_order_no: number | string;
  display_order_label: string | null;
  created_at: string;
  total_minor: number | string;
  customer_contact_id: string | null;
  customer_name_snapshot: string | null;
  normalized_phone_snapshot: string | null;
  order_type_label_snapshot: string;
  order_type_behavior_snapshot: string;
  address_snapshot: string | null;
  delivery_zone_label_snapshot: string | null;
  final_delivery_fee_minor: number | string;
};

type PaymentRow = {
  id: string;
  payment_method_label_snapshot: string;
  logic_type_snapshot: string;
  allocated_minor: number | string;
  received_minor: number | string | null;
  change_minor: number | string | null;
};

type ItemRow = {
  id: string;
  product_id: string;
  product_name_snapshot: string;
  unit_price_minor: number | string;
  quantity: number | string;
  item_note: string | null;
  line_position: number | string;
};

type ModifierRow = {
  id: string | null;
  order_item_id: string;
  modifier_label_snapshot: string;
  unit_price_minor: number | string;
  quantity: number | string;
  position: number | string;
};

type BeverageRow = {
  order_item_id: string;
  beverage_product_id: string;
  beverage_label_snapshot: string;
  unit_index: number | string;
};

type StatusRow = {
  id: string;
  event_type: string;
  worker_name_snapshot: string | null;
  admin_employee_id: string | null;
  operational_revision: number | string;
  from_status: AdminOrderStatus | null;
  to_status: AdminOrderStatus | null;
  reason_code_id: string | null;
  reason_code_key: string | null;
  reason_label_snapshot: string | null;
  reason_family_snapshot: 'CANCELLATION' | 'REFUND_RETURN' | 'DISCOUNT_COMP' | null;
  reason_config_version: number | string | null;
  note: string | null;
  created_at: string;
};

type MovementRow = {
  id: string;
  inventory_item_id: string;
  movement_type: string;
  quantity_delta_micros: number | string;
  reserved_delta_micros: number | string;
  created_at: string;
};

type AuditRow = {
  id: string;
  action_type: string;
  actor_employee_id: string | null;
  created_at: string;
};

function safeInteger(value: number | string | null): number {
  if (value === null) return 0;
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('orders_backend_contract_invalid');
  return result;
}

function encodeCursor(row: Pick<OrderRow, 'created_at' | 'id'>): string {
  return Buffer.from(JSON.stringify([row.created_at, row.id]), 'utf8').toString('base64url');
}

function decodeCursor(value: string | null): readonly [string, string] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string' ||
      !Number.isFinite(Date.parse(parsed[0])) ||
      !uuidSchema.safeParse(parsed[1]).success
    ) {
      return null;
    }
    return [parsed[0], parsed[1]];
  } catch {
    return null;
  }
}

function normalizedSearchTerm(value: string | null): string {
  return (value ?? '')
    .trim()
    .slice(0, 80)
    .replace(/[,*().%]/g, '');
}

function eventStatus(row: StatusRow): AdminOrderStatus {
  if (row.to_status) return row.to_status;
  switch (row.event_type) {
    case 'MARKED_DONE':
      return 'DONE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'DELIVERY_RETURNED':
      return 'RETURNED';
    default:
      return 'ACTIVE';
  }
}

async function assertBusinessShop(
  client: AdminSupabaseClient,
  businessId: string,
  shopId: string,
): Promise<void> {
  const rows = await client.select<Array<{ shop_id: string }>>(
    'business_shops',
    new URLSearchParams({
      select: 'shop_id',
      business_id: `eq.${businessId}`,
      shop_id: `eq.${shopId}`,
      limit: '1',
    }),
  );
  if (rows.length !== 1) throw new AdminAuthorizationError('shop_forbidden');
}

export function createOrderStore(client: AdminSupabaseClient): OrderStore {
  return {
    async searchOrders(input): Promise<AdminOrderSearchResult> {
      await assertBusinessShop(client, input.businessId, input.shopId);
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
      const query = new URLSearchParams({
        select:
          'id,shop_id,status,operational_revision,source,display_order_no,display_order_label,created_at,total_minor,customer_contact_id,customer_name_snapshot,normalized_phone_snapshot,order_type_label_snapshot,order_type_behavior_snapshot,address_snapshot,delivery_zone_label_snapshot,final_delivery_fee_minor',
        shop_id: `eq.${input.shopId}`,
        order: 'created_at.desc,id.desc',
        limit: String(limit + 1),
      });
      if (input.statuses && input.statuses.length > 0) {
        query.set('status', `in.(${input.statuses.join(',')})`);
      }
      if (input.source) query.set('source', `eq.${input.source}`);
      if (input.from) query.set('created_at', `gte.${input.from}`);
      if (input.to) query.append('created_at', `lte.${input.to}`);

      const cursor = decodeCursor(input.cursor ?? null);
      if (input.cursor && !cursor) throw new Error('invalid_order_cursor');
      if (cursor) {
        query.set(
          'or',
          `(created_at.lt.${cursor[0]},and(created_at.eq.${cursor[0]},id.lt.${cursor[1]}))`,
        );
      }

      const term = normalizedSearchTerm(input.query ?? null);
      if (term) {
        if (/^\d+$/.test(term)) {
          query.append('or', `(display_order_no.eq.${term},normalized_phone_snapshot.ilike.*${term}*)`);
        } else {
          query.append(
            'or',
            `(customer_name_snapshot.ilike.*${term}*,normalized_phone_snapshot.ilike.*${term}*,operator_name_snapshot.ilike.*${term}*)`,
          );
        }
      }

      const rows = await client.select<OrderRow[]>('orders', query);
      const visible = rows.slice(0, limit);
      const next = rows.length > limit ? visible.at(-1) ?? null : null;
      return {
        shopId: input.shopId,
        rows: visible.map((row) => ({
          id: row.id,
          shopId: row.shop_id,
          status: row.status,
          operationalRevision: safeInteger(row.operational_revision),
          source: row.source,
          displayOrderNo: safeInteger(row.display_order_no),
          displayOrderLabel: row.display_order_label,
          createdAt: row.created_at,
          totalMinor: safeInteger(row.total_minor),
          customerName: row.customer_name_snapshot,
          normalizedPhone: row.normalized_phone_snapshot,
          orderTypeLabel: row.order_type_label_snapshot,
        })),
        nextCursor: next ? encodeCursor(next) : null,
      };
    },

    async getOrderDetail(input): Promise<AdminOrderDetail | null> {
      await assertBusinessShop(client, input.businessId, input.shopId);
      const orders = await client.select<OrderRow[]>(
        'orders',
        new URLSearchParams({
          select:
            'id,shop_id,status,operational_revision,source,display_order_no,display_order_label,created_at,total_minor,customer_contact_id,customer_name_snapshot,normalized_phone_snapshot,order_type_label_snapshot,order_type_behavior_snapshot,address_snapshot,delivery_zone_label_snapshot,final_delivery_fee_minor',
          id: `eq.${input.orderId}`,
          shop_id: `eq.${input.shopId}`,
          limit: '1',
        }),
      );
      const order = orders[0];
      if (!order) return null;

      const [payments, items, statusRows, movementRows, auditRows] = await Promise.all([
        client.select<PaymentRow[]>(
          'payments',
          new URLSearchParams({
            select:
              'id,payment_method_label_snapshot,logic_type_snapshot,allocated_minor,received_minor,change_minor',
            order_id: `eq.${input.orderId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'part_index.asc',
          }),
        ),
        client.select<ItemRow[]>(
          'order_items',
          new URLSearchParams({
            select:
              'id,product_id,product_name_snapshot,unit_price_minor,quantity,item_note,line_position',
            order_id: `eq.${input.orderId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'line_position.asc,id.asc',
          }),
        ),
        client.select<StatusRow[]>(
          'order_status_events',
          new URLSearchParams({
            select:
              'id,event_type,worker_name_snapshot,admin_employee_id,operational_revision,from_status,to_status,reason_code_id,reason_code_key,reason_label_snapshot,reason_family_snapshot,reason_config_version,note,created_at',
            order_id: `eq.${input.orderId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'operational_revision.asc,created_at.asc,id.asc',
          }),
        ),
        client.select<MovementRow[]>(
          'inventory_movements',
          new URLSearchParams({
            select:
              'id,inventory_item_id,movement_type,quantity_delta_micros,reserved_delta_micros,created_at',
            order_id: `eq.${input.orderId}`,
            shop_id: `eq.${input.shopId}`,
            order: 'created_at.asc,id.asc',
          }),
        ),
        client.select<AuditRow[]>(
          'admin_audit_events',
          new URLSearchParams({
            select: 'id,action_type,actor_employee_id,created_at',
            business_id: `eq.${input.businessId}`,
            shop_id: `eq.${input.shopId}`,
            entity_type: 'eq.ORDER',
            entity_id: `eq.${input.orderId}`,
            order: 'created_at.asc,id.asc',
          }),
        ),
      ]);

      const itemIds = items.map((item) => item.id);
      const [modifiers, beverages] =
        itemIds.length === 0
          ? [[], []]
          : await Promise.all([
              client.select<ModifierRow[]>(
                'order_item_modifiers',
                new URLSearchParams({
                  select:
                    'id,order_item_id,modifier_label_snapshot,unit_price_minor,quantity,position',
                  order_item_id: `in.(${itemIds.join(',')})`,
                  shop_id: `eq.${input.shopId}`,
                  order: 'order_item_id.asc,position.asc',
                }),
              ),
              client.select<BeverageRow[]>(
                'order_item_combo_beverages',
                new URLSearchParams({
                  select:
                    'order_item_id,beverage_product_id,beverage_label_snapshot,unit_index',
                  order_item_id: `in.(${itemIds.join(',')})`,
                  shop_id: `eq.${input.shopId}`,
                  order: 'order_item_id.asc,unit_index.asc',
                }),
              ),
            ]);

      return {
        id: order.id,
        shopId: order.shop_id,
        status: order.status,
        operationalRevision: safeInteger(order.operational_revision),
        source: order.source,
        displayOrderNo: safeInteger(order.display_order_no),
        displayOrderLabel: order.display_order_label,
        createdAt: order.created_at,
        totalMinor: safeInteger(order.total_minor),
        customer:
          order.customer_contact_id || order.customer_name_snapshot || order.normalized_phone_snapshot
            ? {
                contactId: order.customer_contact_id,
                name: order.customer_name_snapshot,
                normalizedPhone: order.normalized_phone_snapshot,
              }
            : null,
        fulfillment: {
          orderTypeLabel: order.order_type_label_snapshot,
          behavior: order.order_type_behavior_snapshot,
          address: order.address_snapshot,
          deliveryZoneLabel: order.delivery_zone_label_snapshot,
          finalDeliveryFeeMinor: safeInteger(order.final_delivery_fee_minor),
        },
        payments: payments.map((payment) => ({
          id: payment.id,
          methodLabel: payment.payment_method_label_snapshot,
          logicType: payment.logic_type_snapshot,
          allocatedMinor: safeInteger(payment.allocated_minor),
          receivedMinor: payment.received_minor === null ? null : safeInteger(payment.received_minor),
          changeMinor: payment.change_minor === null ? null : safeInteger(payment.change_minor),
        })),
        items: items.map((item) => ({
          id: item.id,
          productId: item.product_id,
          productName: item.product_name_snapshot,
          quantity: safeInteger(item.quantity),
          unitPriceMinor: safeInteger(item.unit_price_minor),
          itemNote: item.item_note,
          modifiers: modifiers
            .filter((modifier) => modifier.order_item_id === item.id)
            .map((modifier) => ({
              id: modifier.id,
              label: modifier.modifier_label_snapshot,
              quantity: safeInteger(modifier.quantity),
              unitPriceMinor: safeInteger(modifier.unit_price_minor),
            })),
          comboBeverages: beverages
            .filter((beverage) => beverage.order_item_id === item.id)
            .map((beverage) => ({
              productId: beverage.beverage_product_id,
              label: beverage.beverage_label_snapshot,
            })),
        })),
        statusHistory: statusRows.map((event) => ({
          id: event.id,
          eventType: event.event_type,
          operationalRevision: safeInteger(event.operational_revision),
          fromStatus: event.from_status,
          toStatus: eventStatus(event),
          workerName: event.worker_name_snapshot,
          adminEmployeeId: event.admin_employee_id,
          reason:
            event.reason_code_id &&
            event.reason_code_key &&
            event.reason_label_snapshot &&
            event.reason_family_snapshot &&
            event.reason_config_version !== null
              ? {
                  id: event.reason_code_id,
                  key: event.reason_code_key,
                  label: event.reason_label_snapshot,
                  family: event.reason_family_snapshot,
                  configurationVersion: safeInteger(event.reason_config_version),
                }
              : null,
          note: event.note,
          createdAt: event.created_at,
        })),
        inventoryMovements: movementRows.map((movement) => ({
          id: movement.id,
          inventoryItemId: movement.inventory_item_id,
          movementType: movement.movement_type,
          quantityDeltaMicros: safeInteger(movement.quantity_delta_micros),
          reservedDeltaMicros: safeInteger(movement.reserved_delta_micros),
          createdAt: movement.created_at,
        })),
        auditEvents: auditRows.map((event) => ({
          id: event.id,
          actionType: event.action_type,
          actorEmployeeId: event.actor_employee_id,
          createdAt: event.created_at,
        })),
      };
    },

    cancelActiveOrder(input) {
      return client.rpc<AdminOrderCancellationResult>('cancel_admin_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_order_id: input.orderId,
        p_reason_code_id: input.reasonCodeId,
        p_expected_operational_revision: input.expectedOperationalRevision,
        p_note: input.note,
        p_command_id: input.commandId,
        p_business_id: input.businessId,
      });
    },

    requestRefund(input) {
      return client.rpc<AdminOrderFinancialMutationResult>('request_admin_order_refund_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_order_id: input.orderId,
        p_payment_id: input.paymentId,
        p_amount_minor: input.amountMinor,
        p_reason_code_id: input.reasonCodeId,
        p_note: input.note,
        p_command_id: input.commandId,
        p_business_id: input.businessId,
      });
    },

    returnOrderItems(input) {
      return client.rpc<AdminOrderFinancialMutationResult>('return_admin_order_items_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_order_id: input.orderId,
        p_items: input.items,
        p_reason_code_id: input.reasonCodeId,
        p_note: input.note,
        p_command_id: input.commandId,
        p_business_id: input.businessId,
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
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
  }
  return context;
}

function sendMutationResult(
  response: AdminResponse,
  result: AdminOrderCancellationResult | AdminOrderFinancialMutationResult,
): void {
  if (result.ok) {
    sendJson(response, 200, result);
    return;
  }
  if (
    result.code.includes('conflict') ||
    result.code.includes('stale') ||
    result.code.includes('exceed') ||
    result.code.includes('not_active')
  ) {
    sendJson(response, 409, result);
    return;
  }
  if (result.code.includes('permission') || result.code.includes('forbidden')) {
    sendJson(response, 403, result);
    return;
  }
  if (result.code.includes('not_found')) {
    sendJson(response, 404, result);
    return;
  }
  sendJson(response, 400, result);
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
    sendJson(response, 400, { error: 'invalid_orders_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (error.responseBody.includes('TUX_ADMIN_ORDER_PERMISSION_REQUIRED')) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    const stale = error.responseBody.match(
      /TUX_ORDER_STALE_OPERATIONAL_REVISION:([A-Z_]+):(\d+)/,
    );
    if (stale) {
      sendJson(response, 409, {
        error: 'stale_operational_revision',
        canonicalStatus: stale[1],
        canonicalOperationalRevision: Number(stale[2]),
      });
      return;
    }
    if (error.responseBody.includes('TUX_ADMIN_ORDER_REASON_INVALID')) {
      sendJson(response, 400, { error: 'invalid_reason_code' });
      return;
    }
    console.error('Admin orders database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin orders request failed');
  sendJson(response, 500, { error: 'admin_request_failed' });
}

export default async function handler(
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
    const service = createOrderService(createOrderStore(client));

    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(url.searchParams.get('shopId'));
      const context = await loadContext(request, client, false);
      const orderId = url.searchParams.get('orderId');
      if (orderId) {
        const detail = await service.getOrderDetail(
          { shopId, orderId: uuidSchema.parse(orderId) },
          context.principal,
        );
        if (!detail) {
          sendJson(response, 404, { error: 'order_not_found' });
          return;
        }
        sendJson(response, 200, detail);
        return;
      }

      const statuses = url.searchParams
        .getAll('status')
        .filter((value): value is AdminOrderStatus =>
          ['ACTIVE', 'DONE', 'CANCELLED', 'RETURNED'].includes(value),
        );
      const sourceValue = url.searchParams.get('source');
      const source = sourceValue === 'POS' || sourceValue === 'ONLINE' ? sourceValue : null;
      const rawLimit = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isSafeInteger(rawLimit) ? rawLimit : 50;
      const result = await service.searchOrders(
        {
          shopId,
          query: url.searchParams.get('q'),
          statuses,
          source,
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
          cursor: url.searchParams.get('cursor'),
          limit,
        },
        context.principal,
      );
      sendJson(response, 200, result);
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request));
    const context = await loadContext(request, client, true);

    switch (command.type) {
      case 'order.cancel':
        sendMutationResult(
          response,
          await service.cancelActiveOrder(command, context.principal),
        );
        return;
      case 'order.refund':
        sendMutationResult(response, await service.requestRefund(command, context.principal));
        return;
      case 'order.return':
        sendMutationResult(response, await service.returnOrderItems(command, context.principal));
        return;
    }
  } catch (error) {
    handleFailure(response, error);
  }
}
