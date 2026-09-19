import type {
  AdminPurchaseOrder,
  AdminPurchasingWorkspace,
  AdminSupplier,
  PurchasingCommandResult,
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
import {
  createPurchasingService,
  type PurchasingStore,
} from '../../server/purchasing/purchasingService.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const nullableText = z.string().trim().max(240).nullable();
const commandIdSchema = z.string().trim().min(1).max(160);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const microsSchema = z.number().int().safe().positive();
const moneySchema = z.number().finite().nonnegative();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('supplier.create'),
      shopId: uuidSchema,
      name: z.string().trim().min(1).max(160),
      contactName: nullableText,
      phone: nullableText,
      email: z.string().trim().email().max(240).nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('po.create'),
      shopId: uuidSchema,
      supplierId: uuidSchema,
      reference: nullableText,
      expectedDeliveryDate: dateSchema,
      lines: z
        .array(
          z
            .object({
              inventoryItemId: uuidSchema,
              purchaseUnitLabel: z.string().trim().min(1).max(120),
              orderedPurchaseUnitsMicros: microsSchema,
              expectedPurchaseUnitCostMinor: moneySchema,
            })
            .strict(),
        )
        .min(1)
        .max(500),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('po.update'),
      shopId: uuidSchema,
      purchaseOrderId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      reference: nullableText,
      expectedDeliveryDate: dateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('po.order'),
      shopId: uuidSchema,
      purchaseOrderId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('po.receive'),
      shopId: uuidSchema,
      purchaseOrderId: uuidSchema,
      commandId: commandIdSchema,
      supplierReference: nullableText,
      lines: z
        .array(
          z
            .object({
              lineId: uuidSchema,
              receivedPurchaseUnitsMicros: microsSchema,
              purchaseUnitCostMinor: moneySchema,
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal('po.return'),
      shopId: uuidSchema,
      purchaseOrderId: uuidSchema,
      commandId: commandIdSchema,
      supplierReference: nullableText,
      lines: z
        .array(
          z
            .object({
              lineId: uuidSchema,
              returnedPurchaseUnitsMicros: microsSchema,
            })
            .strict(),
        )
        .min(1)
        .max(500),
    })
    .strict(),
]);

type SupplierRow = {
  id: string;
  business_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
};

type PurchaseOrderRow = {
  id: string;
  shop_id: string;
  supplier_id: string;
  status: AdminPurchaseOrder['status'];
  reference: string | null;
  expected_delivery_date: string | null;
  version: number | string;
  ordered_at: string | null;
  created_at: string;
  updated_at: string;
};

type PurchaseOrderLineRow = {
  id: string;
  purchase_order_id: string;
  inventory_item_id: string;
  purchase_unit_label: string;
  base_micros_per_purchase_unit: number | string;
  ordered_purchase_units_micros: number | string;
  received_purchase_units_micros: number | string;
  returned_purchase_units_micros: number | string;
  ordered_base_micros: number | string;
  received_base_micros: number | string;
  returned_base_micros: number | string;
  expected_purchase_unit_cost_minor: number | string;
  expected_unit_cost_minor: number | string;
};

type InventoryItemRow = {
  id: string;
  name: string;
  unit_label: string;
  active: boolean;
};

function safeInteger(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('purchasing_backend_contract_invalid');
  return result;
}

function finiteNumber(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new Error('purchasing_backend_contract_invalid');
  }
  return result;
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

function createStore(client: AdminSupabaseClient): PurchasingStore {
  return {
    async loadWorkspace(shopId, businessId): Promise<AdminPurchasingWorkspace> {
      const [supplierRows, purchaseOrderRows, inventoryRows] = await Promise.all([
        client.select<SupplierRow[]>(
          'suppliers',
          new URLSearchParams({
            select: 'id,business_id,name,contact_name,phone,email,active',
            business_id: `eq.${businessId}`,
            order: 'name.asc,id.asc',
          }),
        ),
        client.select<PurchaseOrderRow[]>(
          'purchase_orders',
          new URLSearchParams({
            select:
              'id,shop_id,supplier_id,status,reference,expected_delivery_date,version,ordered_at,created_at,updated_at',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'created_at.desc,id.desc',
            limit: '500',
          }),
        ),
        client.select<InventoryItemRow[]>(
          'inventory_items',
          new URLSearchParams({
            select: 'id,name,unit_label,active',
            shop_id: `eq.${shopId}`,
            active: 'eq.true',
            order: 'name.asc,id.asc',
          }),
        ),
      ]);

      const purchaseOrderIds = purchaseOrderRows.map((row) => row.id);
      const lineRows =
        purchaseOrderIds.length === 0
          ? []
          : await client.select<PurchaseOrderLineRow[]>(
              'purchase_order_lines',
              new URLSearchParams({
                select:
                  'id,purchase_order_id,inventory_item_id,purchase_unit_label,base_micros_per_purchase_unit,ordered_purchase_units_micros,received_purchase_units_micros,returned_purchase_units_micros,ordered_base_micros,received_base_micros,returned_base_micros,expected_purchase_unit_cost_minor,expected_unit_cost_minor',
                purchase_order_id: `in.(${purchaseOrderIds.join(',')})`,
                order: 'purchase_order_id.asc,id.asc',
              }),
            );

      const suppliers: AdminSupplier[] = supplierRows.map((row) => ({
        id: row.id,
        businessId: row.business_id,
        name: row.name,
        contactName: row.contact_name,
        phone: row.phone,
        email: row.email,
        active: row.active,
      }));
      const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
      const itemNames = new Map(
        inventoryRows.map((item) => [item.id, { name: item.name, unitLabel: item.unit_label }]),
      );
      const linesByOrder = new Map<string, PurchaseOrderLineRow[]>();
      for (const line of lineRows) {
        const list = linesByOrder.get(line.purchase_order_id) ?? [];
        list.push(line);
        linesByOrder.set(line.purchase_order_id, list);
      }

      return {
        shopId,
        suppliers,
        inventoryItems: inventoryRows.map((row) => ({
          id: row.id,
          name: row.name,
          unitLabel: row.unit_label,
        })),
        purchaseOrders: purchaseOrderRows.map((row) => ({
          id: row.id,
          shopId: row.shop_id,
          supplierId: row.supplier_id,
          supplierName: supplierNames.get(row.supplier_id) ?? 'Supplier',
          status: row.status,
          reference: row.reference,
          expectedDeliveryDate: row.expected_delivery_date,
          version: safeInteger(row.version),
          orderedAt: row.ordered_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lines: (linesByOrder.get(row.id) ?? []).map((line) => {
            const orderedBaseMicros = safeInteger(line.ordered_base_micros);
            const receivedBaseMicros = safeInteger(line.received_base_micros);
            const item = itemNames.get(line.inventory_item_id);
            return {
              id: line.id,
              inventoryItemId: line.inventory_item_id,
              itemName: item?.name ?? 'Inventory item',
              unitLabel: item?.unitLabel ?? 'unit',
              purchaseUnitLabel: line.purchase_unit_label,
              baseMicrosPerPurchaseUnit: safeInteger(line.base_micros_per_purchase_unit),
              orderedPurchaseUnitsMicros: safeInteger(line.ordered_purchase_units_micros),
              receivedPurchaseUnitsMicros: safeInteger(line.received_purchase_units_micros),
              returnedPurchaseUnitsMicros: safeInteger(line.returned_purchase_units_micros),
              orderedBaseMicros,
              receivedBaseMicros,
              returnedBaseMicros: safeInteger(line.returned_base_micros),
              remainingBaseMicros: Math.max(0, orderedBaseMicros - receivedBaseMicros),
              expectedPurchaseUnitCostMinor: finiteNumber(
                line.expected_purchase_unit_cost_minor,
              ),
              expectedUnitCostMinor: finiteNumber(line.expected_unit_cost_minor),
            };
          }),
        })),
      };
    },

    createSupplier(input) {
      return client.rpc<PurchasingCommandResult>('create_supplier_v1', {
        p_employee_id: input.employeeId,
        p_business_id: input.businessId,
        p_shop_id: input.shopId,
        p_name: input.name,
        p_contact_name: input.contactName,
        p_phone: input.phone,
        p_email: input.email,
      });
    },

    createPurchaseOrder(input) {
      return client.rpc<PurchasingCommandResult>('create_purchase_order_v1', {
        p_employee_id: input.employeeId,
        p_business_id: input.businessId,
        p_shop_id: input.shopId,
        p_supplier_id: input.supplierId,
        p_reference: input.reference,
        p_expected_delivery_date: input.expectedDeliveryDate,
        p_lines: input.lines,
        p_command_id: input.commandId,
      });
    },

    updatePurchaseOrder(input) {
      return client.rpc<PurchasingCommandResult>('update_purchase_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_purchase_order_id: input.purchaseOrderId,
        p_expected_version: input.expectedVersion,
        p_reference: input.reference,
        p_expected_delivery_date: input.expectedDeliveryDate,
      });
    },

    orderPurchaseOrder(input) {
      return client.rpc<PurchasingCommandResult>('order_purchase_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_purchase_order_id: input.purchaseOrderId,
        p_expected_version: input.expectedVersion,
        p_command_id: input.commandId,
      });
    },

    receivePurchase(input) {
      return client.rpc<PurchasingCommandResult>('receive_purchase_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_purchase_order_id: input.purchaseOrderId,
        p_command_id: input.commandId,
        p_supplier_reference: input.supplierReference,
        p_lines: input.lines,
      });
    },

    returnPurchase(input) {
      return client.rpc<PurchasingCommandResult>('return_purchase_order_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_purchase_order_id: input.purchaseOrderId,
        p_command_id: input.commandId,
        p_supplier_reference: input.supplierReference,
        p_lines: input.lines,
      });
    },
  };
}

function failureStatus(result: PurchasingCommandResult): number {
  if (result.ok) return 200;
  if (
    result.code === 'stale_version' ||
    result.code.includes('exceeds') ||
    result.code.includes('conflict') ||
    result.code === 'insufficient_stock'
  ) {
    return 409;
  }
  if (result.code.includes('forbidden') || result.code.includes('permission')) return 403;
  if (result.code.includes('not_found')) return 404;
  return 400;
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
    sendJson(response, 400, { error: 'invalid_purchasing_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (error.responseBody.includes('TUX_ADMIN_PURCHASING_PERMISSION_REQUIRED')) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    console.error('Admin purchasing database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin purchasing request failed');
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
    const service = createPurchasingService(createStore(client));

    if (request.method === 'GET') {
      const shopId = uuidSchema.parse(
        new URL(request.url ?? '/', 'http://admin.local').searchParams.get('shopId'),
      );
      const context = await loadContext(request, client, false);
      sendJson(response, 200, await service.loadWorkspace(shopId, context.principal));
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request));
    const context = await loadContext(request, client, true);
    let result: PurchasingCommandResult;

    switch (command.type) {
      case 'supplier.create':
        result = await service.createSupplier(command, context.principal);
        break;
      case 'po.create':
        result = await service.createPurchaseOrder(command, context.principal);
        break;
      case 'po.update':
        result = await service.updatePurchaseOrder(command, context.principal);
        break;
      case 'po.order':
        result = await service.orderPurchaseOrder(command, context.principal);
        break;
      case 'po.receive':
        result = await service.receivePurchase(command, context.principal);
        break;
      case 'po.return':
        result = await service.returnPurchase(command, context.principal);
        break;
    }

    sendJson(response, failureStatus(result), result);
  } catch (error) {
    handleFailure(response, error);
  }
}
