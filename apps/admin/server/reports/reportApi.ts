import { z } from 'zod';
import { AdminAuthError, loadAdminSession, requireSessionCsrf } from '../adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../authorization.js';
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

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const area = z.enum([
  'sales',
  'profit',
  'products',
  'inventory-consumption',
  'waste',
  'theoretical-variance',
  'margin-variance',
  'purchasing',
  'customers',
  'payments',
  'expenses',
  'staff',
  'delivery',
  'refunds',
  'tax',
  'end-day',
  'bank-cash',
  'shop-comparison',
  'loyalty',
  'promotions',
  'segments',
  'attendance',
]);
const commandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('report.view.save'),
      shopId: uuid,
      id: uuid.nullable(),
      expectedVersion: z.number().int().nonnegative(),
      name: z.string().trim().min(1).max(100),
      reportArea: area,
      filters: z.record(z.string(), z.unknown()),
      layout: z.record(z.string(), z.unknown()),
      commandId: uuid,
    })
    .strict(),
  z
    .object({
      type: z.literal('report.view.delete'),
      shopId: uuid,
      id: uuid,
      expectedVersion: z.number().int().positive(),
      commandId: uuid,
    })
    .strict(),
  z
    .object({
      type: z.literal('report.target.set'),
      shopId: uuid,
      metric: z.enum(['NET_SALES', 'ORDER_COUNT', 'FOOD_COST_PERCENT', 'WASTE']),
      periodStart: isoDate,
      periodEnd: isoDate,
      targetValue: z.number().int().safe().nonnegative(),
      expectedVersion: z.number().int().nonnegative(),
      commandId: uuid,
    })
    .strict(),
]);
function respondError(response: AdminResponse, error: unknown) {
  if (error instanceof AdminAuthError) sendJson(response, error.status, { error: error.code });
  else if (error instanceof AdminAuthorizationError) sendJson(response, 403, { error: error.code });
  else if (error instanceof z.ZodError)
    sendJson(response, 400, { error: 'report_request_invalid' });
  else if (error instanceof AdminSupabaseError) {
    console.error('Report database failure', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
  } else {
    console.error('Report request failed');
    sendJson(response, 500, { error: 'admin_request_failed' });
  }
}
function rpcFailure(response: AdminResponse, value: Record<string, unknown>) {
  const code = typeof value['code'] === 'string' ? value['code'] : 'report_unavailable';
  sendJson(response, code.endsWith('_conflict') ? 409 : 400, { error: code });
}
function safeDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error('report_date_invalid');
  }
  return parsed;
}
function dateLabel(date: number): string {
  return new Date(date).toISOString().slice(0, 10);
}

export async function handleReportsRequest(
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
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const context = await loadAdminSession(token, client);
    const principal = context.principal;
    if (request.method === 'GET') {
      const query = new URL(request.url ?? '/', 'http://admin.local').searchParams;
      const shopId = uuid.parse(query.get('shopId'));
      requirePermission(principal, 'reports.view', shopId);
      if (query.get('view') === 'configuration') {
        const data = await client.rpc<Record<string, unknown>>('admin_report_config_query_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: shopId,
        });
        if (data['ok'] !== true) {
          rpcFailure(response, data);
          return;
        }
        sendJson(response, 200, data);
        return;
      }
      if (query.get('view') === 'filter-options') {
        const definitions = [
          ['orderTypes', 'order_types', 'name'],
          ['paymentMethods', 'payment_methods', 'display_name'],
          ['workers', 'workers', 'display_name'],
          ['customers', 'customer_contacts', 'name'],
          ['products', 'products', 'name'],
          ['categories', 'menu_categories', 'name'],
          ['deliveryZones', 'delivery_zones', 'name'],
        ] as const;
        const optionSets = await Promise.all(
          definitions.map(async ([key, table, label]) => {
            const rows = await client.select<Array<Record<string, unknown>>>(
              table,
              new URLSearchParams({
                select: `id,${label}`,
                shop_id: `eq.${shopId}`,
                order: `${label}.asc`,
                limit: '100',
              }),
            );
            return [
              key,
              rows.map((item) => ({ id: item['id'], label: item[label] || 'Unnamed' })),
            ] as const;
          }),
        );
        if (principal.role === 'OWNER' || principal.role === 'ADMIN') {
          const businessDefinitions = [
            ['promotions', 'promotion_rules', 'name'],
            ['suppliers', 'suppliers', 'name'],
            ['employees', 'business_employees', 'display_name'],
          ] as const;
          const businessSets = await Promise.all(
            businessDefinitions.map(async ([key, table, label]) => {
              const rows = await client.select<Array<Record<string, unknown>>>(
                table,
                new URLSearchParams({
                  select: `id,${label}`,
                  business_id: `eq.${principal.businessId}`,
                  order: `${label}.asc`,
                  limit: '100',
                }),
              );
              return [
                key,
                rows.map((item) => ({ id: item['id'], label: item[label] || 'Unnamed' })),
              ] as const;
            }),
          );
          sendJson(response, 200, {
            options: Object.fromEntries([...optionSets, ...businessSets]),
          });
          return;
        }
        sendJson(response, 200, { options: Object.fromEntries(optionSets) });
        return;
      }
      const shops = query.getAll('reportShopId');
      const selected = shops.length > 0 ? z.array(uuid).min(1).max(50).parse(shops) : [shopId];
      if (new Set(selected).size !== selected.length) {
        sendJson(response, 400, { error: 'report_duplicate_shops' });
        return;
      }
      for (const id of selected) requirePermission(principal, 'reports.view', id);
      if (query.get('view') === 'dashboard') {
        const dateToday = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Cairo',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
        const from = isoDate.parse(query.get('from') ?? dateToday);
        const to = isoDate.parse(query.get('to') ?? dateToday);
        const fromMs = safeDate(from);
        const toMs = safeDate(to);
        if (fromMs > toMs || toMs - fromMs > 31 * 86400000) {
          sendJson(response, 400, { error: 'dashboard_range_invalid' });
          return;
        }
        const result = await client.rpc<Record<string, unknown>>(
          'admin_plan7_dashboard_metrics_v1',
          {
            p_actor_employee_id: principal.employeeId,
            p_shop_ids: selected,
            p_start_date: from,
            p_end_date: to,
          },
        );
        if (result['ok'] !== true) {
          rpcFailure(response, result);
          return;
        }
        sendJson(response, 200, result);
        return;
      }
      const selectedArea = area.parse(query.get('area') ?? 'sales');
      const dateNow = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const from = isoDate.parse(query.get('from') ?? dateNow);
      const to = isoDate.parse(query.get('to') ?? dateNow);
      const fromUtc = safeDate(from),
        toUtc = safeDate(to);
      if (fromUtc > toUtc || toUtc - fromUtc > 730 * 86400000) {
        sendJson(response, 400, { error: 'report_range_invalid' });
        return;
      }
      const pageSize = z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .parse(query.get('pageSize') ?? '50');
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(20000)
        .parse(query.get('offset') ?? '0');
      const source = z.enum(['POS', 'ONLINE']).nullable().parse(query.get('source'));
      const contextSchema = z
        .object({
          orderTypeId: uuid.optional(),
          paymentMethodId: uuid.optional(),
          workerId: uuid.optional(),
          employeeId: uuid.optional(),
          customerId: uuid.optional(),
          productId: uuid.optional(),
          categoryId: uuid.optional(),
          promotionId: uuid.optional(),
          supplierId: uuid.optional(),
          deliveryZoneId: uuid.optional(),
          status: z
            .string()
            .regex(/^[A-Z_]{2,40}$/)
            .optional(),
        })
        .strict();
      const context = contextSchema.parse(
        Object.fromEntries(
          [
            'orderTypeId',
            'paymentMethodId',
            'workerId',
            'employeeId',
            'customerId',
            'productId',
            'categoryId',
            'promotionId',
            'supplierId',
            'deliveryZoneId',
            'status',
          ]
            .filter((key) => query.has(key))
            .map((key) => [key, query.get(key)]),
        ),
      );
      const args = {
        p_actor_employee_id: principal.employeeId,
        p_shop_ids: selected,
        p_area: selectedArea,
        p_start_date: from,
        p_end_date: to,
        p_page_limit: pageSize,
        p_offset: offset,
        p_source: source,
        p_context: context,
      };
      const current = await client.rpc<Record<string, unknown>>(
        'admin_finance_report_query_v2',
        args,
      );
      if (current['ok'] !== true) {
        rpcFailure(response, current);
        return;
      }
      const comparison = z
        .enum(['previous', 'week', 'month', 'year'])
        .nullable()
        .parse(query.get('compare'));
      if (comparison === null) {
        sendJson(response, 200, current);
        return;
      }
      const days = Math.round((toUtc - fromUtc) / 86400000) + 1;
      let previousTo = dateLabel(fromUtc - 86400000);
      let previousFrom = dateLabel(fromUtc - days * 86400000);
      if (comparison === 'week') {
        previousFrom = dateLabel(fromUtc - 7 * 86400000);
      } else if (comparison === 'month') {
        const firstDay = new Date(fromUtc);
        const start = Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() - 1, 1);
        const end = Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), 1) - 86400000;
        previousFrom = dateLabel(start);
        previousTo = dateLabel(end);
      } else if (comparison === 'year') {
        const y = new Date(fromUtc).getUTCFullYear() - 1;
        previousFrom = dateLabel(Date.UTC(y, 0, 1));
        previousTo = dateLabel(Date.UTC(y, 11, 31));
      }
      const previous = await client.rpc<Record<string, unknown>>('admin_finance_report_query_v2', {
        ...args,
        p_start_date: previousFrom,
        p_end_date: previousTo,
        p_page_limit: 1,
        p_offset: 0,
      });
      if (previous['ok'] !== true) {
        rpcFailure(response, previous);
        return;
      }
      sendJson(response, 200, {
        ...current,
        comparison: {
          periodStart: previousFrom,
          periodEnd: previousTo,
          summary: previous['summary'],
        },
      });
      return;
    }
    if (!requireSameOrigin(request, response)) return;
    const command = commandSchema.parse(await readJsonObject(request));
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    requirePermission(
      principal,
      command.type === 'report.target.set' ? 'settings.manage' : 'reports.view',
      command.shopId,
    );
    const action =
      command.type === 'report.view.save'
        ? 'SAVE_VIEW'
        : command.type === 'report.view.delete'
          ? 'DELETE_VIEW'
          : 'SET_TARGET';
    const {
      type: ignored,
      shopId: ignoredShopId,
      commandId: ignoredCommandId,
      ...payload
    } = command;
    void ignored;
    void ignoredShopId;
    void ignoredCommandId;
    const result = await client.rpc<Record<string, unknown>>('admin_report_config_command_v1', {
      p_actor_employee_id: principal.employeeId,
      p_shop_id: command.shopId,
      p_action: action,
      p_payload: payload,
      p_command_id: command.commandId,
    });
    if (result['ok'] !== true) {
      rpcFailure(response, result);
      return;
    }
    sendJson(response, 200, result);
  } catch (error) {
    respondError(response, error);
  }
}
