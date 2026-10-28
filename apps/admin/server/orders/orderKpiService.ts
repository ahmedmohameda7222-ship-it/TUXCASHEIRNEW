import type { AdminOrderKpisResult, AdminSessionPrincipal } from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';

export type OrdersKpiRequest = {
  shopId: string;
  from: string | null;
  to: string | null;
};

type KpiRpc = {
  rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T>;
};

function exactInstant(value: string | null): number | null {
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error('invalid_orders_kpi_range');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('invalid_orders_kpi_range');
  }
  return parsed;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function minor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export async function queryOrdersKpis(
  request: OrdersKpiRequest,
  principal: AdminSessionPrincipal,
  client: KpiRpc,
): Promise<AdminOrderKpisResult> {
  requirePermission(principal, 'orders.view', request.shopId);
  const fromMs = exactInstant(request.from);
  const toMs = exactInstant(request.to);
  if (
    fromMs !== null &&
    toMs !== null &&
    (fromMs > toMs || toMs - fromMs > 366 * 24 * 60 * 60 * 1000)
  ) {
    throw new Error('invalid_orders_kpi_range');
  }

  const result = await client.rpc<Record<string, unknown>>('admin_orders_kpis_v1', {
    p_actor_employee_id: principal.employeeId,
    p_shop_id: request.shopId,
    p_from: request.from,
    p_to: request.to,
  });

  if (result['ok'] !== true) {
    const code = result['code'];
    throw new Error(typeof code === 'string' ? code : 'orders_kpis_invalid');
  }
  if (
    result['shopId'] !== request.shopId ||
    !count(result['orderCount']) ||
    !count(result['activeOrderCount']) ||
    result['activeOrderCount'] > result['orderCount'] ||
    !(result['netSalesMinor'] === null || minor(result['netSalesMinor'])) ||
    !(result['averageOrderMinor'] === null || minor(result['averageOrderMinor'])) ||
    !(result['denominatorPaidOrderCount'] === null || count(result['denominatorPaidOrderCount']))
  ) {
    throw new Error('orders_kpis_invalid');
  }

  const allowedFinance = principal.permissions.includes('finance.view');
  return {
    shopId: request.shopId,
    orderCount: result['orderCount'],
    activeOrderCount: result['activeOrderCount'],
    netSalesMinor: allowedFinance ? result['netSalesMinor'] : null,
    averageOrderMinor: allowedFinance ? result['averageOrderMinor'] : null,
    denominatorPaidOrderCount: allowedFinance ? result['denominatorPaidOrderCount'] : null,
  } as AdminOrderKpisResult;
}
