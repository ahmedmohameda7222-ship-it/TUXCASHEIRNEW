import type { AdminSessionPrincipal, ReportDrilldown } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type SourceRow = {
  id: string;
  shopId: string;
  sourceKind: string;
  drilldown?: ReportDrilldown | null;
};

type SourceMap = {
  table: string;
  key: string;
  selected: string;
  targetColumn: string;
  permission: string;
  target: (id: string, sourceId: string) => ReportDrilldown;
};

const PARENTS: Readonly<Record<string, SourceMap>> = {
  payment: {
    table: 'payments',
    key: 'id',
    selected: 'id,shop_id,order_id',
    targetColumn: 'order_id',
    permission: 'orders.view',
    target: (id) => ({ type: 'ORDER', orderId: id }),
  },
  refund: {
    table: 'admin_order_refunds',
    key: 'id',
    selected: 'id,shop_id,order_id',
    targetColumn: 'order_id',
    permission: 'orders.view',
    target: (id) => ({ type: 'ORDER', orderId: id }),
  },
  return: {
    table: 'admin_order_returns',
    key: 'id',
    selected: 'id,shop_id,order_id',
    targetColumn: 'order_id',
    permission: 'orders.view',
    target: (id) => ({ type: 'ORDER', orderId: id }),
  },
  'order-item': {
    table: 'order_items',
    key: 'id',
    selected: 'id,shop_id,order_id',
    targetColumn: 'order_id',
    permission: 'orders.view',
    target: (id) => ({ type: 'ORDER', orderId: id }),
  },
  'inventory-movement': {
    table: 'inventory_movements',
    key: 'id',
    selected: 'id,shop_id,inventory_item_id',
    targetColumn: 'inventory_item_id',
    permission: 'inventory.view',
    target: (id) => ({ type: 'INVENTORY_ITEM', inventoryItemId: id }),
  },
  'attendance-event': {
    table: 'attendance_events',
    key: 'id',
    selected: 'id,shop_id,employee_id',
    targetColumn: 'employee_id',
    permission: 'staff.view',
    target: (id) => ({ type: 'STAFF', employeeId: id, section: 'attendance' }),
  },
  'staff-payment': {
    table: 'staff_payment_expense_events',
    key: 'staff_payment_record_id',
    selected: 'staff_payment_record_id,shop_id,employee_id',
    targetColumn: 'employee_id',
    permission: 'staff.view',
    target: (id) => ({ type: 'STAFF', employeeId: id, section: 'pay' }),
  },
  'finance-movement': {
    table: 'finance_movements',
    key: 'id',
    selected: 'id,shop_id,finance_account_id',
    targetColumn: 'finance_account_id',
    permission: 'finance.view',
    target: (id, sourceId) => ({ type: 'FINANCE_ACCOUNT', accountId: id, movementId: sourceId }),
  },
  'bank-fee': {
    table: 'finance_movements',
    key: 'id',
    selected: 'id,shop_id,finance_account_id',
    targetColumn: 'finance_account_id',
    permission: 'finance.view',
    target: (id, sourceId) => ({ type: 'FINANCE_ACCOUNT', accountId: id, movementId: sourceId }),
  },
  'financial-z': {
    table: 'end_day_financial_snapshots',
    key: 'id',
    selected: 'id,shop_id,business_day_id',
    targetColumn: 'business_day_id',
    permission: 'finance.view',
    target: (id) => ({ type: 'FINANCIAL_DAY', businessDayId: id }),
  },
};

function directTarget(row: SourceRow, principal: AdminSessionPrincipal): ReportDrilldown | null {
  const permission = principal.permissions;
  if (
    ['customer-order', 'delivery-order', 'tax-service'].includes(row.sourceKind) &&
    permission.includes('orders.view')
  )
    return { type: 'ORDER', orderId: row.id };
  if (row.sourceKind === 'purchase-order' && permission.includes('purchasing.view'))
    return { type: 'PURCHASE_ORDER', purchaseOrderId: row.id };
  if (row.sourceKind === 'expense' && permission.includes('finance.view'))
    return { type: 'EXPENSE', expenseId: row.id };
  return null;
}

/** Resolves canonical parent IDs in bounded table queries, never from sourceKind in the browser. */
export async function enrichReportDrilldowns(
  rows: SourceRow[],
  principal: AdminSessionPrincipal,
  client: AdminSupabaseClient,
): Promise<Array<SourceRow & { drilldown: ReportDrilldown | null }>> {
  const parents = new Map<string, ReportDrilldown>();
  const lookups = new Map<string, { map: SourceMap; shopId: string; ids: string[] }>();
  for (const row of rows.slice(0, 100)) {
    if (!principal.shopIds.includes(row.shopId)) continue;
    const mapping = PARENTS[row.sourceKind];
    if (!mapping || !principal.permissions.includes(mapping.permission as never)) continue;
    const groupKey = `${row.sourceKind}:${row.shopId}`;
    const group = lookups.get(groupKey) ?? { map: mapping, shopId: row.shopId, ids: [] };
    group.ids.push(row.id);
    lookups.set(groupKey, group);
  }
  await Promise.all(
    [...lookups.values()].map(async ({ map, shopId, ids }) => {
      const records = await client.select<Array<Record<string, unknown>>>(
        map.table,
        new URLSearchParams({
          select: map.selected,
          shop_id: `eq.${shopId}`,
          [map.key]: `in.(${ids.join(',')})`,
          limit: '100',
        }),
      );
      for (const record of records) {
        const id = record[map.targetColumn];
        const sourceId = record[map.key];
        if (typeof id !== 'string' || typeof sourceId !== 'string') continue;
        parents.set(`${shopId}:${sourceId}`, map.target(id, sourceId));
      }
    }),
  );
  return rows.map((row) => ({
    ...row,
    drilldown: principal.shopIds.includes(row.shopId)
      ? (parents.get(`${row.shopId}:${row.id}`) ?? directTarget(row, principal))
      : null,
  }));
}
