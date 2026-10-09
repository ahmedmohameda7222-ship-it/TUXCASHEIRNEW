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

type RelationshipSource = { table: string; domain: string; segment: boolean };

const RELATIONSHIP_SOURCES: Readonly<Record<string, RelationshipSource>> = {
  'loyalty-event': { table: 'loyalty_ledger', domain: 'loyalty.manage', segment: false },
  'promotion-use': { table: 'promotion_usage_ledger', domain: 'promotions.manage', segment: false },
  'customer-segment': { table: 'customer_segments', domain: 'customers.view', segment: true },
};

type ExactRelation = { sourceId: string; orderId: string | null; customerId: string | null };
type RelationshipGroup = {
  sourceKind: string;
  shopId: string;
  ids: string[];
  mapping: RelationshipSource;
};

/**
 * Resolve event IDs through trusted business/shop-scoped source rows, then verify
 * the actual addressable order/contact is in that SAME authorized shop.
 * A report source ID alone never grants access to a target record.
 */
async function resolveRelationshipDrilldowns(
  rows: SourceRow[],
  principal: AdminSessionPrincipal,
  client: AdminSupabaseClient,
  targets: Map<string, ReportDrilldown>,
): Promise<void> {
  const groups = new Map<string, RelationshipGroup>();
  for (const row of rows.slice(0, 100)) {
    const mapping = RELATIONSHIP_SOURCES[row.sourceKind];
    if (
      !mapping ||
      !principal.shopIds.includes(row.shopId) ||
      !principal.permissions.includes('reports.view') ||
      !principal.permissions.includes(mapping.domain as never)
    )
      continue;
    if (
      !principal.permissions.includes('orders.view') &&
      !principal.permissions.includes('customers.view')
    )
      continue;
    const key = `${row.sourceKind}:${row.shopId}`;
    const group = groups.get(key) ?? {
      sourceKind: row.sourceKind,
      shopId: row.shopId,
      ids: [],
      mapping,
    };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  await Promise.all(
    [...groups.values()].map(async ({ shopId, ids, mapping }) => {
      const sourceRecords = await client.select<Array<Record<string, unknown>>>(
        mapping.table,
        new URLSearchParams({
          select: mapping.segment
            ? 'id,business_id,canonical_customer_id'
            : 'id,business_id,shop_id,order_id,customer_id',
          ...(mapping.segment ? {} : { shop_id: `eq.${shopId}` }),
          business_id: `eq.${principal.businessId}`,
          id: `in.(${ids.join(',')})`,
          limit: '100',
        }),
      );
      const requested = new Set(ids);
      const relations: ExactRelation[] = [];
      for (const record of sourceRecords) {
        if (
          typeof record.id !== 'string' ||
          !requested.has(record.id) ||
          record.business_id !== principal.businessId ||
          (!mapping.segment && record.shop_id !== shopId)
        )
          continue;
        relations.push({
          sourceId: record.id,
          orderId: !mapping.segment && typeof record.order_id === 'string' ? record.order_id : null,
          customerId: mapping.segment
            ? typeof record.canonical_customer_id === 'string'
              ? record.canonical_customer_id
              : null
            : typeof record.customer_id === 'string'
              ? record.customer_id
              : null,
        });
      }

      const orderIds = [
        ...new Set(relations.map((row) => row.orderId).filter((id): id is string => Boolean(id))),
      ];
      const validOrders = new Set<string>();
      if (principal.permissions.includes('orders.view') && orderIds.length > 0) {
        const orders = await client.select<Array<Record<string, unknown>>>(
          'orders',
          new URLSearchParams({
            select: 'id,shop_id',
            shop_id: `eq.${shopId}`,
            id: `in.(${orderIds.join(',')})`,
            limit: '100',
          }),
        );
        for (const order of orders) {
          if (
            order.shop_id === shopId &&
            typeof order.id === 'string' &&
            orderIds.includes(order.id)
          )
            validOrders.add(order.id);
        }
      }

      const customerIds = [
        ...new Set(
          relations.map((row) => row.customerId).filter((id): id is string => Boolean(id)),
        ),
      ];
      const validContacts = new Map<string, string>();
      if (principal.permissions.includes('customers.view') && customerIds.length > 0) {
        const contacts = await client.select<Array<Record<string, unknown>>>(
          'customer_contacts',
          new URLSearchParams({
            select: 'id,shop_id,canonical_customer_id',
            shop_id: `eq.${shopId}`,
            canonical_customer_id: `in.(${customerIds.join(',')})`,
            order: 'id.asc',
            limit: '100',
          }),
        );
        for (const contact of contacts) {
          if (
            contact.shop_id === shopId &&
            typeof contact.id === 'string' &&
            typeof contact.canonical_customer_id === 'string' &&
            customerIds.includes(contact.canonical_customer_id) &&
            !validContacts.has(contact.canonical_customer_id)
          )
            validContacts.set(contact.canonical_customer_id, contact.id);
        }
      }

      for (const relation of relations) {
        const key = `${shopId}:${relation.sourceId}`;
        if (relation.orderId && validOrders.has(relation.orderId)) {
          targets.set(key, { type: 'ORDER', orderId: relation.orderId });
        } else if (relation.customerId) {
          const contact = validContacts.get(relation.customerId);
          if (contact) targets.set(key, { type: 'CUSTOMER', customerId: contact });
        }
      }
    }),
  );
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
  await resolveRelationshipDrilldowns(rows, principal, client, parents);
  return rows.map((row) => ({
    ...row,
    drilldown: principal.shopIds.includes(row.shopId)
      ? (parents.get(`${row.shopId}:${row.id}`) ?? directTarget(row, principal))
      : null,
  }));
}
