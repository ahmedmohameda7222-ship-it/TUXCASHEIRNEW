import type {
  AdminInventoryCommand,
  AdminInventoryCommandResult,
  AdminInventoryItem,
  AdminInventoryReasonCode,
  AdminInventoryTransfer,
  AdminInventoryWorkspace,
} from '@tux/admin-contracts';
import { z } from 'zod';

import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
  type AdminSessionContext,
} from '../../server/adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../../server/authorization.js';
import { getAdminServerEnv } from '../../server/env.js';
import {
  loadInventoryIntelligence,
  updateReplenishmentPolicy,
} from '../../server/inventory/intelligenceService.js';
import {
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../../server/http.js';
import { readAdminSessionToken } from '../../server/session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../../server/supabaseAdmin.js';

const uuidSchema = z.string().uuid();
const microsSchema = z.number().int().safe();
const positiveMicrosSchema = microsSchema.positive();
const commandIdSchema = z.string().trim().min(1).max(160);
const noteSchema = z.string().trim().max(500).nullable();

const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('adjust'),
      shopId: uuidSchema,
      inventoryItemId: uuidSchema,
      quantityDeltaMicros: microsSchema.refine((value) => value !== 0),
      reasonCodeId: uuidSchema,
      note: noteSchema,
      emergencyNegativeOverride: z.boolean(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('waste'),
      shopId: uuidSchema,
      inventoryItemId: uuidSchema,
      quantityMicros: positiveMicrosSchema,
      reasonCodeId: uuidSchema,
      note: noteSchema,
      emergencyNegativeOverride: z.boolean(),
      commandId: commandIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('stocktake'),
      shopId: uuidSchema,
      lines: z
        .array(
          z
            .object({
              inventoryItemId: uuidSchema,
              actualCountMicros: microsSchema.nonnegative(),
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
      type: z.literal('transfer.send'),
      shopId: uuidSchema,
      destinationShopId: uuidSchema,
      lines: z
        .array(
          z
            .object({
              inventoryItemId: uuidSchema,
              quantityMicros: positiveMicrosSchema,
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
      type: z.literal('replenishment.update'),
      shopId: uuidSchema,
      inventoryItemId: uuidSchema,
      parLevelMicros: microsSchema.nonnegative(),
      reorderPointMicros: microsSchema.nonnegative(),
      preferredPurchaseUnit: z.string().trim().min(1).max(120).nullable(),
      leadTimeDays: z.number().int().min(0).max(3650),
      minimumOrderMicros: positiveMicrosSchema.nullable(),
      orderMultipleMicros: positiveMicrosSchema.nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('transfer.receive'),
      shopId: uuidSchema,
      transferId: uuidSchema,
      commandId: commandIdSchema,
    })
    .strict(),
]);

type InventoryItemRow = {
  id: string;
  shop_id: string;
  name: string;
  unit_label: string;
  tracking_mode: string;
  active: boolean;
};

type MovementRow = {
  id: string;
  inventory_item_id: string;
  movement_type: string;
  quantity_delta_micros: number | string;
  reserved_delta_micros: number | string;
  reason_label_snapshot: string | null;
  created_at: string;
};

type CostRow = {
  inventory_item_id: string;
  weighted_unit_cost_minor: number | string;
};

type ReasonRow = {
  id: string;
  shop_id: string | null;
  reason_key: string;
  family: string;
  label: string;
  version: number | string;
};

type TransferRow = {
  id: string;
  source_shop_id: string;
  destination_shop_id: string;
  status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  sent_at: string;
  received_at: string | null;
};

type TransferLineRow = {
  transfer_id: string;
  inventory_item_id: string;
  quantity_micros: number | string;
};

function safeInteger(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('inventory_backend_contract_invalid');
  return result;
}

function finiteNumber(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new Error('inventory_backend_contract_invalid');
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

function selectScopedReasons(
  rows: readonly ReasonRow[],
  shopId: string,
): AdminInventoryReasonCode[] {
  const selected = new Map<string, ReasonRow>();
  for (const row of rows) {
    if (row.family !== 'WASTE' && row.family !== 'STOCK_ADJUSTMENT') continue;
    if (row.shop_id !== null && row.shop_id !== shopId) continue;
    const key = `${row.family}:${row.reason_key}`;
    const current = selected.get(key);
    if (
      !current ||
      (current.shop_id === null && row.shop_id === shopId) ||
      (current.shop_id === row.shop_id && safeInteger(row.version) > safeInteger(current.version))
    ) {
      selected.set(key, row);
    }
  }
  return [...selected.values()]
    .map((row) => ({
      id: row.id,
      key: row.reason_key,
      family: row.family as AdminInventoryReasonCode['family'],
      label: row.label,
    }))
    .sort(
      (left, right) =>
        left.family.localeCompare(right.family) || left.label.localeCompare(right.label),
    );
}

async function loadWorkspace(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  shopId: string,
): Promise<AdminInventoryWorkspace> {
  requirePermission(context.principal, 'inventory.view', shopId);

  const [itemRows, movementRows, costRows, reasonRows, transferRows] = await Promise.all([
    client.select<InventoryItemRow[]>(
      'inventory_items',
      new URLSearchParams({
        select: 'id,shop_id,name,unit_label,tracking_mode,active',
        shop_id: `eq.${shopId}`,
        order: 'name.asc,id.asc',
      }),
    ),
    client.select<MovementRow[]>(
      'inventory_movements',
      new URLSearchParams({
        select:
          'id,inventory_item_id,movement_type,quantity_delta_micros,reserved_delta_micros,reason_label_snapshot,created_at',
        shop_id: `eq.${shopId}`,
        order: 'created_at.desc,id.desc',
        limit: '2000',
      }),
    ),
    client.select<CostRow[]>(
      'inventory_cost_state',
      new URLSearchParams({
        select: 'inventory_item_id,weighted_unit_cost_minor',
        shop_id: `eq.${shopId}`,
      }),
    ),
    client.select<ReasonRow[]>(
      'admin_reason_codes',
      new URLSearchParams({
        select: 'id,shop_id,reason_key,family,label,version',
        business_id: `eq.${context.principal.businessId}`,
        active: 'eq.true',
        or: `(shop_id.is.null,shop_id.eq.${shopId})`,
        order: 'family.asc,reason_key.asc,version.desc',
      }),
    ),
    client.select<TransferRow[]>(
      'stock_transfers',
      new URLSearchParams({
        select: 'id,source_shop_id,destination_shop_id,status,sent_at,received_at',
        or: `(source_shop_id.eq.${shopId},destination_shop_id.eq.${shopId})`,
        order: 'sent_at.desc,id.desc',
        limit: '100',
      }),
    ),
  ]);

  const transferIds = transferRows.map((row) => row.id);
  const transferLineRows =
    transferIds.length === 0
      ? []
      : await client.select<TransferLineRow[]>(
          'stock_transfer_lines',
          new URLSearchParams({
            select: 'transfer_id,inventory_item_id,quantity_micros',
            transfer_id: `in.(${transferIds.join(',')})`,
            order: 'transfer_id.asc,inventory_item_id.asc',
          }),
        );

  const transferItemIds = [...new Set(transferLineRows.map((line) => line.inventory_item_id))];
  const transferItemRows =
    transferItemIds.length === 0
      ? []
      : await client.select<InventoryItemRow[]>(
          'inventory_items',
          new URLSearchParams({
            select: 'id,shop_id,name,unit_label,tracking_mode,active',
            id: `in.(${transferItemIds.join(',')})`,
          }),
        );

  const movementsByItem = new Map<string, MovementRow[]>();
  for (const movement of movementRows) {
    const list = movementsByItem.get(movement.inventory_item_id) ?? [];
    list.push(movement);
    movementsByItem.set(movement.inventory_item_id, list);
  }
  const costs = new Map(
    costRows.map((row) => [row.inventory_item_id, finiteNumber(row.weighted_unit_cost_minor)]),
  );

  const items: AdminInventoryItem[] = itemRows.map((row) => {
    const movements = movementsByItem.get(row.id) ?? [];
    const onHandMicros = movements.reduce(
      (total, movement) => total + safeInteger(movement.quantity_delta_micros),
      0,
    );
    const reservedMicros = movements.reduce(
      (total, movement) => total + safeInteger(movement.reserved_delta_micros),
      0,
    );
    return {
      id: row.id,
      name: row.name,
      unitLabel: row.unit_label,
      trackingMode: row.tracking_mode,
      active: row.active,
      onHandMicros,
      reservedMicros,
      availableMicros: onHandMicros - reservedMicros,
      weightedUnitCostMinor: costs.get(row.id) ?? 0,
      history: movements.slice(0, 50).map((movement) => ({
        id: movement.id,
        movementType: movement.movement_type,
        quantityDeltaMicros: safeInteger(movement.quantity_delta_micros),
        reservedDeltaMicros: safeInteger(movement.reserved_delta_micros),
        reasonLabel: movement.reason_label_snapshot,
        createdAt: movement.created_at,
      })),
    };
  });

  const itemNames = new Map(
    [...itemRows, ...transferItemRows].map((row) => [
      row.id,
      { name: row.name, unitLabel: row.unit_label },
    ]),
  );
  const linesByTransfer = new Map<string, TransferLineRow[]>();
  for (const line of transferLineRows) {
    const list = linesByTransfer.get(line.transfer_id) ?? [];
    list.push(line);
    linesByTransfer.set(line.transfer_id, list);
  }
  const transfers: AdminInventoryTransfer[] = transferRows.map((row) => ({
    id: row.id,
    sourceShopId: row.source_shop_id,
    destinationShopId: row.destination_shop_id,
    status: row.status,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    lines: (linesByTransfer.get(row.id) ?? []).map((line) => {
      const item = itemNames.get(line.inventory_item_id);
      return {
        inventoryItemId: line.inventory_item_id,
        itemName: item?.name ?? 'Inventory item',
        unitLabel: item?.unitLabel ?? 'unit',
        quantityMicros: safeInteger(line.quantity_micros),
      };
    }),
  }));

  const intelligence = await loadInventoryIntelligence(client, shopId, items);

  return {
    shopId,
    items,
    reasonCodes: selectScopedReasons(reasonRows, shopId),
    transfers,
    intelligence,
  };
}

function commandFailureStatus(result: AdminInventoryCommandResult): number {
  if (result.ok) return 200;
  if (result.code === 'insufficient_stock' || result.code.includes('conflict')) return 409;
  if (result.code.includes('forbidden') || result.code.includes('permission')) return 403;
  if (result.code.includes('not_found')) return 404;
  return 400;
}

async function executeCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: AdminInventoryCommand,
): Promise<AdminInventoryCommandResult> {
  switch (command.type) {
    case 'adjust': {
      requirePermission(context.principal, 'inventory.adjust', command.shopId);
      if (command.emergencyNegativeOverride) {
        requirePermission(context.principal, 'inventory.override_negative', command.shopId);
      }
      return client.rpc<AdminInventoryCommandResult>('post_inventory_adjustment_v1', {
        p_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_inventory_item_id: command.inventoryItemId,
        p_quantity_delta_micros: command.quantityDeltaMicros,
        p_reason_code_id: command.reasonCodeId,
        p_note: command.note,
        p_command_id: command.commandId,
        p_emergency_negative_override: command.emergencyNegativeOverride,
      });
    }
    case 'waste': {
      requirePermission(context.principal, 'inventory.adjust', command.shopId);
      if (command.emergencyNegativeOverride) {
        requirePermission(context.principal, 'inventory.override_negative', command.shopId);
      }
      return client.rpc<AdminInventoryCommandResult>('post_inventory_waste_v1', {
        p_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_inventory_item_id: command.inventoryItemId,
        p_quantity_micros: command.quantityMicros,
        p_reason_code_id: command.reasonCodeId,
        p_note: command.note,
        p_command_id: command.commandId,
        p_emergency_negative_override: command.emergencyNegativeOverride,
      });
    }
    case 'stocktake':
      requirePermission(context.principal, 'inventory.stocktake', command.shopId);
      return client.rpc<AdminInventoryCommandResult>('post_stocktake_v1', {
        p_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_lines: command.lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          actualCountMicros: line.actualCountMicros,
        })),
        p_command_id: command.commandId,
      });
    case 'replenishment.update':
      requirePermission(context.principal, 'purchasing.manage', command.shopId);
      await updateReplenishmentPolicy(client, {
        employeeId: context.principal.employeeId,
        shopId: command.shopId,
        inventoryItemId: command.inventoryItemId,
        parLevelMicros: command.parLevelMicros,
        reorderPointMicros: command.reorderPointMicros,
        preferredPurchaseUnit: command.preferredPurchaseUnit,
        leadTimeDays: command.leadTimeDays,
        minimumOrderMicros: command.minimumOrderMicros,
        orderMultipleMicros: command.orderMultipleMicros,
      });
      return { ok: true };
    case 'transfer.send':
      requirePermission(context.principal, 'inventory.transfer', command.shopId);
      requirePermission(context.principal, 'inventory.transfer', command.destinationShopId);
      return client.rpc<AdminInventoryCommandResult>('send_stock_transfer_v1', {
        p_employee_id: context.principal.employeeId,
        p_source_shop_id: command.shopId,
        p_destination_shop_id: command.destinationShopId,
        p_lines: command.lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantityMicros: line.quantityMicros,
        })),
        p_command_id: command.commandId,
      });
    case 'transfer.receive':
      requirePermission(context.principal, 'inventory.transfer', command.shopId);
      return client.rpc<AdminInventoryCommandResult>('receive_stock_transfer_v1', {
        p_employee_id: context.principal.employeeId,
        p_transfer_id: command.transferId,
        p_command_id: command.commandId,
      });
  }
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
    sendJson(response, 400, { error: 'invalid_inventory_request' });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    if (
      error.responseBody.includes('TUX_ADMIN_INVENTORY_PERMISSION_REQUIRED') ||
      error.responseBody.includes('TUX_ADMIN_INVENTORY_REASON_INVALID')
    ) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    console.error('Admin inventory database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  console.error('Admin inventory request failed');
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
    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = uuidSchema.parse(url.searchParams.get('shopId'));
      const context = await loadContext(request, client, false);
      sendJson(response, 200, { ...(await loadWorkspace(client, context, shopId)) });
      return;
    }

    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request)) as AdminInventoryCommand;
    const context = await loadContext(request, client, true);
    const result = await executeCommand(client, context, command);
    sendJson(response, commandFailureStatus(result), result);
  } catch (error) {
    handleFailure(response, error);
  }
}
