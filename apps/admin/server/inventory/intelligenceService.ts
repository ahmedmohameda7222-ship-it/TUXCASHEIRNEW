import type {
  AdminInventoryIntelligence,
  AdminInventoryItem,
  AdminInventoryMarginAlert,
  AdminInventoryReorderSuggestion,
  AdminInventoryVariance,
} from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import {
  calculateActualVsTheoretical,
  calculateFoodCostMarginAlert,
  suggestOrderQuantity,
} from './intelligence.js';

const REPORT_WINDOW_DAYS = 30;
const MOVEMENT_PAGE_SIZE = 10_000;
const RECIPE_PAGE_SIZE = 10_000;
const REPLENISHMENT_PAGE_SIZE = 10_000;
const PRODUCT_PAGE_SIZE = 10_000;
const MARGIN_SETTING_PAGE_SIZE = 10_000;
const PURCHASE_ORDER_PAGE_SIZE = 10_000;
const PURCHASE_ORDER_BATCH_SIZE = 100;
const ORDER_STATUS_BATCH_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

type ReplenishmentRow = {
  inventory_item_id: string;
  par_level_base: number | string;
  reorder_point_base: number | string;
  preferred_supplier_id: string | null;
  preferred_purchase_unit: string | null;
  lead_time_days: number | string;
  minimum_order_quantity_base: number | string | null;
  order_multiple_base: number | string | null;
  version: number | string;
};

type MarginSettingRow = {
  product_id: string;
  target_food_cost_percent: number | string;
  alert_food_cost_percent: number | string;
};

type ProductRow = {
  id: string;
  name: string;
  price_minor: number | string;
  active: boolean;
};

type RecipeRow = {
  product_id: string;
  inventory_item_id: string;
  quantity_micros: number | string;
};

type PeriodMovementRow = {
  inventory_item_id: string;
  movement_type: string;
  quantity_delta_micros: number | string;
  order_id: string | null;
};

type OrderStatusRow = {
  id: string;
  status: string;
};

type PurchaseOrderRow = {
  id: string;
  status: string;
};

type PurchaseOrderLineRow = {
  purchase_order_id: string;
  inventory_item_id: string;
  ordered_base_micros: number | string;
  received_base_micros: number | string;
};

function safeInteger(value: number | string, label: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error(`inventory_intelligence_invalid:${label}`);
  return result;
}

function finiteNumber(value: number | string, label: string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(`inventory_intelligence_invalid:${label}`);
  return result;
}

function nullablePositiveInteger(value: number | string | null, label: string): number | null {
  if (value === null) return null;
  const parsed = safeInteger(value, label);
  if (parsed <= 0) throw new Error(`inventory_intelligence_invalid:${label}`);
  return parsed;
}

function reportStart(now: number): string {
  return new Date(now - REPORT_WINDOW_DAYS * DAY_MS).toISOString();
}

async function loadPeriodMovements(
  client: AdminSupabaseClient,
  shopId: string,
  from: string,
): Promise<PeriodMovementRow[]> {
  const movements: PeriodMovementRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<PeriodMovementRow[]>(
      'inventory_movements',
      new URLSearchParams({
        select: 'inventory_item_id,movement_type,quantity_delta_micros,order_id',
        shop_id: `eq.${shopId}`,
        created_at: `gte.${from}`,
        order: 'created_at.asc,id.asc',
        limit: String(MOVEMENT_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return movements;
    movements.push(...page);
    offset += page.length;
  }
}

async function loadReplenishmentRows(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<ReplenishmentRow[]> {
  const rows: ReplenishmentRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<ReplenishmentRow[]>(
      'inventory_replenishment_settings',
      new URLSearchParams({
        select:
          'inventory_item_id,par_level_base,reorder_point_base,preferred_supplier_id,preferred_purchase_unit,lead_time_days,minimum_order_quantity_base,order_multiple_base,version',
        shop_id: `eq.${shopId}`,
        order: 'inventory_item_id.asc',
        limit: String(REPLENISHMENT_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function loadProductRows(client: AdminSupabaseClient, shopId: string): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<ProductRow[]>(
      'products',
      new URLSearchParams({
        select: 'id,name,price_minor,active',
        shop_id: `eq.${shopId}`,
        active: 'eq.true',
        order: 'name.asc,id.asc',
        limit: String(PRODUCT_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function loadMarginRows(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<MarginSettingRow[]> {
  const rows: MarginSettingRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<MarginSettingRow[]>(
      'inventory_margin_settings',
      new URLSearchParams({
        select: 'product_id,target_food_cost_percent,alert_food_cost_percent',
        shop_id: `eq.${shopId}`,
        order: 'product_id.asc',
        limit: String(MARGIN_SETTING_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function loadRecipeLines(client: AdminSupabaseClient, shopId: string): Promise<RecipeRow[]> {
  const rows: RecipeRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<RecipeRow[]>(
      'recipe_lines',
      new URLSearchParams({
        select: 'product_id,inventory_item_id,quantity_micros',
        shop_id: `eq.${shopId}`,
        order: 'product_id.asc,inventory_item_id.asc',
        limit: String(RECIPE_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function loadOpenPurchaseOrders(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<PurchaseOrderRow[]> {
  const rows: PurchaseOrderRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.select<PurchaseOrderRow[]>(
      'purchase_orders',
      new URLSearchParams({
        select: 'id,status',
        shop_id: `eq.${shopId}`,
        status: 'in.(ORDERED,PARTIALLY_RECEIVED)',
        order: 'id.asc',
        limit: String(PURCHASE_ORDER_PAGE_SIZE),
        offset: String(offset),
      }),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
    offset += page.length;
  }
}

async function loadOpenPurchaseOrderLines(
  client: AdminSupabaseClient,
  purchaseOrderIds: readonly string[],
): Promise<PurchaseOrderLineRow[]> {
  const rows: PurchaseOrderLineRow[] = [];
  for (let start = 0; start < purchaseOrderIds.length; start += PURCHASE_ORDER_BATCH_SIZE) {
    const batch = purchaseOrderIds.slice(start, start + PURCHASE_ORDER_BATCH_SIZE);
    let offset = 0;
    for (;;) {
      const page = await client.select<PurchaseOrderLineRow[]>(
        'purchase_order_lines',
        new URLSearchParams({
          select: 'purchase_order_id,inventory_item_id,ordered_base_micros,received_base_micros',
          purchase_order_id: `in.(${batch.join(',')})`,
          order: 'purchase_order_id.asc,inventory_item_id.asc',
          limit: String(PURCHASE_ORDER_PAGE_SIZE),
          offset: String(offset),
        }),
      );
      if (page.length === 0) break;
      rows.push(...page);
      offset += page.length;
    }
  }
  return rows;
}

async function loadOrderStatuses(
  client: AdminSupabaseClient,
  orderIds: readonly string[],
): Promise<OrderStatusRow[]> {
  const rows: OrderStatusRow[] = [];
  for (let start = 0; start < orderIds.length; start += ORDER_STATUS_BATCH_SIZE) {
    const batch = orderIds.slice(start, start + ORDER_STATUS_BATCH_SIZE);
    let offset = 0;
    while (offset < batch.length) {
      const page = await client.select<OrderStatusRow[]>(
        'orders',
        new URLSearchParams({
          select: 'id,status',
          id: `in.(${batch.join(',')})`,
          order: 'id.asc',
          limit: String(batch.length),
          offset: String(offset),
        }),
      );
      if (page.length === 0) break;
      rows.push(...page);
      offset += page.length;
    }
  }
  return rows;
}

export async function loadInventoryIntelligence(
  client: AdminSupabaseClient,
  shopId: string,
  items: readonly AdminInventoryItem[],
  now = Date.now(),
): Promise<AdminInventoryIntelligence> {
  const from = reportStart(now);
  const [
    replenishmentRows,
    periodMovements,
    productRows,
    recipeRows,
    marginRows,
    purchaseOrderRows,
  ] = await Promise.all([
    loadReplenishmentRows(client, shopId),
    loadPeriodMovements(client, shopId, from),
    loadProductRows(client, shopId),
    loadRecipeLines(client, shopId),
    loadMarginRows(client, shopId),
    loadOpenPurchaseOrders(client, shopId),
  ]);

  const orderIds = [
    ...new Set(
      periodMovements
        .map((movement) => movement.order_id)
        .filter((orderId): orderId is string => orderId !== null),
    ),
  ];
  const orderRows = orderIds.length === 0 ? [] : await loadOrderStatuses(client, orderIds);
  const orderStatus = new Map(orderRows.map((row) => [row.id, row.status]));

  const openPurchaseOrderIds = new Set(
    purchaseOrderRows
      .filter((row) => row.status === 'ORDERED' || row.status === 'PARTIALLY_RECEIVED')
      .map((row) => row.id),
  );
  const purchaseOrderLines =
    openPurchaseOrderIds.size === 0
      ? []
      : await loadOpenPurchaseOrderLines(client, [...openPurchaseOrderIds]);
  const incomingByItem = new Map<string, number>();
  for (const line of purchaseOrderLines) {
    if (!openPurchaseOrderIds.has(line.purchase_order_id)) continue;
    const ordered = safeInteger(line.ordered_base_micros, 'purchase-order-ordered');
    const received = safeInteger(line.received_base_micros, 'purchase-order-received');
    const remaining = Math.max(0, ordered - received);
    incomingByItem.set(
      line.inventory_item_id,
      (incomingByItem.get(line.inventory_item_id) ?? 0) + remaining,
    );
  }

  const itemMap = new Map(items.map((item) => [item.id, item]));
  const replenishmentMap = new Map(replenishmentRows.map((row) => [row.inventory_item_id, row]));

  const reorderSuggestions: AdminInventoryReorderSuggestion[] = items
    .filter((item) => item.active)
    .map((item) => {
      const policy = replenishmentMap.get(item.id);
      const parLevelMicros = policy ? safeInteger(policy.par_level_base, 'par') : 0;
      const incomingMicros = incomingByItem.get(item.id) ?? 0;
      const minimumOrderMicros = policy
        ? nullablePositiveInteger(policy.minimum_order_quantity_base, 'minimum-order')
        : null;
      const orderMultipleMicros = policy
        ? nullablePositiveInteger(policy.order_multiple_base, 'order-multiple')
        : null;
      return {
        inventoryItemId: item.id,
        itemName: item.name,
        unitLabel: item.unitLabel,
        availableMicros: item.availableMicros,
        incomingMicros,
        parLevelMicros,
        reorderPointMicros: policy ? safeInteger(policy.reorder_point_base, 'reorder-point') : 0,
        suggestedOrderMicros: suggestOrderQuantity({
          available: item.availableMicros,
          par: parLevelMicros,
          incoming: incomingMicros,
          minimumOrder: minimumOrderMicros,
          orderMultiple: orderMultipleMicros,
        }),
        preferredSupplierId: policy?.preferred_supplier_id ?? null,
        preferredPurchaseUnit: policy?.preferred_purchase_unit ?? null,
        leadTimeDays: policy ? safeInteger(policy.lead_time_days, 'lead-time') : 0,
        minimumOrderMicros,
        orderMultipleMicros,
        version: policy ? safeInteger(policy.version, 'version') : 0,
      };
    })
    .sort(
      (left, right) =>
        right.suggestedOrderMicros - left.suggestedOrderMicros ||
        left.itemName.localeCompare(right.itemName),
    );

  const theoreticalDelta = new Map<string, number>();
  const actualDelta = new Map<string, number>();
  const actualMovementTypes = new Set([
    'ORDER_CONSUMPTION',
    'ORDER_CONSUMPTION_REVERSAL',
    'CANCEL_RESTOCK',
    'WASTE',
    'ADMIN_ADJUSTMENT',
    'STOCKTAKE_ADJUSTMENT',
  ]);
  for (const movement of periodMovements) {
    const delta = safeInteger(movement.quantity_delta_micros, 'movement-delta');
    if (actualMovementTypes.has(movement.movement_type)) {
      actualDelta.set(
        movement.inventory_item_id,
        (actualDelta.get(movement.inventory_item_id) ?? 0) + delta,
      );
    }
    if (
      movement.order_id !== null &&
      (orderStatus.get(movement.order_id) === 'DONE' ||
        orderStatus.get(movement.order_id) === 'RETURNED') &&
      (movement.movement_type === 'ORDER_CONSUMPTION' ||
        movement.movement_type === 'ORDER_CONSUMPTION_REVERSAL')
    ) {
      theoreticalDelta.set(
        movement.inventory_item_id,
        (theoreticalDelta.get(movement.inventory_item_id) ?? 0) + delta,
      );
    }
  }

  const variances: AdminInventoryVariance[] = items
    .filter((item) => item.active)
    .map((item) => {
      const result = calculateActualVsTheoretical({
        actualUsageMicros: Math.max(0, -(actualDelta.get(item.id) ?? 0)),
        theoreticalUsageMicros: Math.max(0, -(theoreticalDelta.get(item.id) ?? 0)),
      });
      return {
        inventoryItemId: item.id,
        itemName: item.name,
        unitLabel: item.unitLabel,
        ...result,
      };
    })
    .filter((row) => row.actualUsageMicros > 0 || row.theoreticalUsageMicros > 0)
    .sort((left, right) => Math.abs(right.varianceMicros) - Math.abs(left.varianceMicros));

  const recipeByProduct = new Map<string, RecipeRow[]>();
  for (const line of recipeRows) {
    const list = recipeByProduct.get(line.product_id) ?? [];
    list.push(line);
    recipeByProduct.set(line.product_id, list);
  }
  const marginMap = new Map(marginRows.map((row) => [row.product_id, row]));
  const marginAlerts: AdminInventoryMarginAlert[] = productRows
    .filter((product) => product.active && finiteNumber(product.price_minor, 'product-price') > 0)
    .map((product) => {
      const policy = marginMap.get(product.id);
      const ingredients = (recipeByProduct.get(product.id) ?? [])
        .map((line) => {
          const item = itemMap.get(line.inventory_item_id);
          if (!item) return null;
          const quantityMicros = safeInteger(line.quantity_micros, 'recipe-quantity');
          return {
            inventoryItemId: item.id,
            itemName: item.name,
            costMinor: (quantityMicros / 1_000_000) * item.weightedUnitCostMinor,
          };
        })
        .filter(
          (
            ingredient,
          ): ingredient is { inventoryItemId: string; itemName: string; costMinor: number } =>
            ingredient !== null,
        );
      const result = calculateFoodCostMarginAlert({
        productPriceMinor: finiteNumber(product.price_minor, 'product-price'),
        targetFoodCostPercent: policy
          ? finiteNumber(policy.target_food_cost_percent, 'target-food-cost')
          : 30,
        alertThresholdPercent: policy
          ? finiteNumber(policy.alert_food_cost_percent, 'alert-food-cost')
          : 35,
        ingredients,
      });
      return {
        productId: product.id,
        productName: product.name,
        productPriceMinor: finiteNumber(product.price_minor, 'product-price'),
        ...result,
      };
    })
    .filter((row) => row.recipeCostMinor > 0)
    .sort(
      (left, right) =>
        Number(right.alert) - Number(left.alert) ||
        right.foodCostPercent - left.foodCostPercent ||
        left.productName.localeCompare(right.productName),
    );

  return {
    periodLabel: `Last ${REPORT_WINDOW_DAYS} days`,
    reorderSuggestions,
    variances,
    marginAlerts,
  };
}

export async function updateReplenishmentPolicy(
  client: AdminSupabaseClient,
  input: {
    employeeId: string;
    shopId: string;
    inventoryItemId: string;
    parLevelMicros: number;
    reorderPointMicros: number;
    preferredPurchaseUnit: string | null;
    leadTimeDays: number;
    minimumOrderMicros: number | null;
    orderMultipleMicros: number | null;
  },
): Promise<void> {
  const existing = await client.select<{ version: number | string }[]>(
    'inventory_replenishment_settings',
    new URLSearchParams({
      select: 'version',
      shop_id: `eq.${input.shopId}`,
      inventory_item_id: `eq.${input.inventoryItemId}`,
      limit: '1',
    }),
  );
  const observedVersion =
    existing.length === 0 ? null : safeInteger(existing[0]!.version, 'version');
  const payload = {
    par_level_base: input.parLevelMicros,
    reorder_point_base: input.reorderPointMicros,
    preferred_purchase_unit: input.preferredPurchaseUnit,
    lead_time_days: input.leadTimeDays,
    minimum_order_quantity_base: input.minimumOrderMicros,
    order_multiple_base: input.orderMultipleMicros,
    updated_by_employee_id: input.employeeId,
    version: observedVersion === null ? 1 : observedVersion + 1,
    updated_at: new Date().toISOString(),
  };

  if (existing.length === 0) {
    await client.insert('inventory_replenishment_settings', {
      shop_id: input.shopId,
      inventory_item_id: input.inventoryItemId,
      preferred_supplier_id: null,
      ...payload,
    });
    return;
  }

  const updated = await client.update<{ version: number | string }[]>(
    'inventory_replenishment_settings',
    new URLSearchParams({
      shop_id: `eq.${input.shopId}`,
      inventory_item_id: `eq.${input.inventoryItemId}`,
      version: `eq.${observedVersion}`,
    }),
    payload,
  );
  if (updated.length !== 1) {
    throw new Error('inventory_replenishment_conflict');
  }
}
