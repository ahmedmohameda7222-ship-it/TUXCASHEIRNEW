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
import { requireRecentReauth, AdminRecentReauthError } from '../reauth.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient, AdminSupabaseError } from '../supabaseAdmin.js';
import { adminRequestOperation } from '../observability.js';
import { maskOwnerSummaryForPrincipal } from './ownerSummaryAuthorization.js';

const uuid = z.string().uuid();
const commandId = uuid;
const minor = z.number().int().safe().positive();
const signedMinor = z
  .number()
  .int()
  .safe()
  .refine((x) => x !== 0);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reason = z.string().trim().min(1).max(500);

const operationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('finance.transfer'),
      shopId: uuid,
      fromAccountId: uuid,
      toAccountId: uuid,
      amountMinor: minor,
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.bank-deposit'),
      shopId: uuid,
      fromAccountId: uuid,
      toAccountId: uuid,
      amountMinor: minor,
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.owner-contribution'),
      shopId: uuid,
      accountId: uuid,
      amountMinor: minor,
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.owner-withdrawal'),
      shopId: uuid,
      accountId: uuid,
      amountMinor: minor,
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.expense.post'),
      shopId: uuid,
      businessDayId: uuid,
      accountId: uuid.nullable(),
      amountMinor: minor,
      description: reason,
      reason,
      categoryId: uuid.nullable(),
      expenseDate: day,
      receiptReference: z.string().trim().max(600).nullable(),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.settlement.record'),
      shopId: uuid,
      fromAccountId: uuid,
      toAccountId: uuid,
      amountMinor: minor,
      feeMinor: z.number().int().safe().nonnegative(),
      settledOn: day,
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.cashier.reconcile'),
      shopId: uuid,
      businessDayId: uuid,
      cashierWorkerId: uuid,
      actualMinor: z.number().int().safe().nonnegative(),
      reason: z.string().trim().max(500).nullable(),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.day.finalize'),
      shopId: uuid,
      businessDayId: uuid,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.category.create'),
      shopId: uuid,
      scope: z.enum(['SHOP', 'BUSINESS']),
      name: z.string().trim().min(1).max(100),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.recurring.rule'),
      shopId: uuid,
      ruleId: uuid.nullable(),
      expectedVersion: z.number().int().nonnegative(),
      categoryId: uuid.nullable(),
      description: reason,
      amountMinor: minor,
      cadence: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
      nextDueDate: day,
      active: z.boolean(),
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.recurring.process'),
      shopId: uuid,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.recurring.post'),
      shopId: uuid,
      occurrenceId: uuid,
      businessDayId: uuid,
      accountId: uuid.nullable(),
      reason,
      commandId,
    })
    .strict(),
  z
    .object({
      type: z.literal('finance.snapshot.adjust'),
      shopId: uuid,
      snapshotId: uuid,
      amountMinor: signedMinor,
      reason,
      commandId,
    })
    .strict(),
]);

const advancedViews = new Set([
  'day',
  'days',
  'day-history',
  'expenses',
  'settlements',
  'categories',
  'owner-summary',
  'cashiers',
  'recurring',
]);

function cairoBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (name: string) => parts.find((item) => item.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function isAdvancedFinanceView(value: string | null): boolean {
  return value !== null && advancedViews.has(value);
}
export function isAdvancedFinanceCommand(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    [
      'finance.transfer',
      'finance.bank-deposit',
      'finance.owner-contribution',
      'finance.owner-withdrawal',
      'finance.expense.post',
      'finance.settlement.record',
      'finance.cashier.reconcile',
      'finance.day.finalize',
      'finance.snapshot.adjust',
      'finance.recurring.rule',
      'finance.recurring.post',
      'finance.recurring.process',
      'finance.category.create',
    ].includes(value)
  );
}

function errorResponse(response: AdminResponse, error: unknown, request: AdminRequest): void {
  if (error instanceof AdminAuthError) sendJson(response, error.status, { error: error.code });
  else if (error instanceof AdminRecentReauthError) {
    sendJson(response, 403, { error: error.code });
  } else if (error instanceof AdminAuthorizationError) {
    sendJson(response, 403, { error: error.code });
  } else if (error instanceof z.ZodError) {
    sendJson(response, 400, { error: 'finance_request_invalid' });
  } else if (error instanceof AdminSupabaseError) {
    console.error('Finance operations backend unavailable', { resource: 'finance', operation: adminRequestOperation(request), status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
  } else {
    console.error('Finance operations unexpected failure', { resource: 'finance', operation: adminRequestOperation(request), status: 500 });
    sendJson(response, 500, { error: 'admin_request_failed' });
  }
}
function selectQuery(args: Record<string, string>): URLSearchParams {
  return new URLSearchParams(args);
}
function sendCommandResponse(response: AdminResponse, result: Record<string, unknown>) {
  if (result['ok'] === true) {
    sendJson(response, 200, result);
    return;
  }
  const code = typeof result['code'] === 'string' ? result['code'] : 'finance_command_failed';
  sendJson(response, code.endsWith('_conflict') || code.includes('already_') ? 409 : 400, {
    error: code,
  });
}

export async function handleAdvancedFinance(
  request: AdminRequest,
  response: AdminResponse,
  suppliedCommand?: Record<string, unknown>,
): Promise<void> {
  try {
    const client = new AdminSupabaseClient(getAdminServerEnv());
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const context = await loadAdminSession(token, client);
    const principal = context.principal;

    if (request.method === 'GET') {
      const query = new URL(request.url ?? '/', 'http://admin.local').searchParams;
      const shopId = uuid.parse(query.get('shopId'));
      const view = query.get('view');
      requirePermission(principal, 'finance.view', shopId);
      if (view === 'days') {
        const rows = await client.select<Array<Record<string, unknown>>>(
          'business_days',
          selectQuery({
            select: 'id,shop_id,status,started_at,ended_at',
            shop_id: `eq.${shopId}`,
            order: 'started_at.desc,id.desc',
            limit: '50',
          }),
        );
        sendJson(response, 200, { days: rows });
        return;
      }
      if (view === 'day') {
        const businessDayId = uuid.parse(query.get('businessDayId'));
        const result = await client.rpc<Record<string, unknown>>('finance_day_report_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: shopId,
          p_business_day_id: businessDayId,
        });
        sendCommandResponse(response, result);
        return;
      }
      if (view === 'day-history') {
        const snapshots = await client.select<Array<Record<string, unknown>>>(
          'end_day_financial_snapshots',
          selectQuery({
            select: 'id,shop_id,business_day_id,snapshot,finalized_at,finalized_by_employee_id',
            business_id: `eq.${principal.businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'finalized_at.desc,id.desc',
            limit: '50',
          }),
        );
        const ids = snapshots.map((s) => String(s['id']));
        const adjustments =
          ids.length === 0
            ? []
            : await client.select<Array<Record<string, unknown>>>(
                'financial_adjustments',
                selectQuery({
                  select: 'id,snapshot_id,amount_minor,reason,created_at',
                  business_id: `eq.${principal.businessId}`,
                  shop_id: `eq.${shopId}`,
                  snapshot_id: `in.(${ids.join(',')})`,
                  order: 'created_at.desc',
                  limit: '500',
                }),
              );
        sendJson(response, 200, { snapshots, adjustments });
        return;
      }
      if (view === 'expenses') {
        const rows = await client.select<Array<Record<string, unknown>>>(
          'expenses',
          selectQuery({
            select:
              'id,shop_id,business_day_id,description,kind,amount_minor,paid_from,created_at,created_by_worker_id,created_by_employee_id,deleted_at',
            shop_id: `eq.${shopId}`,
            kind: 'eq.MANUAL',
            deleted_at: 'is.null',
            order: 'created_at.desc,id.desc',
            limit: '50',
          }),
        );
        sendJson(response, 200, { expenses: rows });
        return;
      }
      if (view === 'settlements') {
        const rows = await client.select<Array<Record<string, unknown>>>(
          'payment_settlements',
          selectQuery({
            select:
              'id,source_account_id,destination_account_id,gross_minor,fee_minor,net_minor,settled_on,reference,created_at',
            business_id: `eq.${principal.businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'created_at.desc,id.desc',
            limit: '50',
          }),
        );
        sendJson(response, 200, { settlements: rows });
        return;
      }
      if (view === 'categories') {
        const categories = await client.select<Array<Record<string, unknown>>>(
          'expense_categories',
          selectQuery({
            select: 'id,shop_id,name,active',
            business_id: `eq.${principal.businessId}`,
            or: `(shop_id.is.null,shop_id.eq.${shopId})`,
            active: 'eq.true',
            order: 'name.asc',
            limit: '100',
          }),
        );
        sendJson(response, 200, { categories });
        return;
      }
      if (view === 'cashiers') {
        const businessDayId = uuid.parse(query.get('businessDayId'));
        const expected = await client.rpc<Record<string, unknown>>(
          'finance_cashier_expectations_v1',
          {
            p_actor_employee_id: principal.employeeId,
            p_shop_id: shopId,
            p_business_day_id: businessDayId,
          },
        );
        if (expected['ok'] !== true) {
          sendCommandResponse(response, expected);
          return;
        }
        const cashiers = Array.isArray(expected['cashiers'])
          ? (expected['cashiers'] as Array<Record<string, unknown>>)
          : [];
        sendJson(response, 200, {
          cashiers,
          workers: cashiers.map((c) => ({
            id: c['cashierWorkerId'],
            display_name: c['displayName'],
            expected_minor: c['expectedMinor'],
          })),
          reconciliations: cashiers
            .filter((c) => c['reconciled'])
            .map((c) => ({
              id: c['cashierWorkerId'],
              cashier_worker_id: c['cashierWorkerId'],
              expected_minor: c['expectedMinor'],
              actual_minor: c['actualMinor'],
              variance_minor: c['varianceMinor'],
            })),
        });
        return;
      }
      if (view === 'recurring') {
        if (principal.permissions.includes('finance.adjust')) {
          const generated = await client.rpc<Record<string, unknown>>(
            'process_due_recurring_expenses_v2',
            {
              p_actor_employee_id: principal.employeeId,
              p_shop_id: shopId,
              p_until: cairoBusinessDate(),
              p_max_rules: 25,
            },
          );
          if (generated['ok'] !== true) {
            sendCommandResponse(response, generated);
            return;
          }
        }
        const result = await client.rpc<Record<string, unknown>>('finance_recurring_workspace_v1', {
          p_actor_employee_id: principal.employeeId,
          p_shop_id: shopId,
        });
        sendCommandResponse(response, result);
        return;
      }
      if (view === 'owner-summary') {
        const summaries = await client.select<Array<Record<string, unknown>>>(
          'daily_owner_summaries',
          selectQuery({
            select: 'id,business_day_id,summary,generated_at',
            business_id: `eq.${principal.businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'generated_at.desc,id.desc',
            limit: '30',
          }),
        );
        sendJson(response, 200, {
          summaries: summaries.map((row) => ({
            id: row['id'],
            business_day_id: row['business_day_id'],
            generated_at: row['generated_at'],
            summary: maskOwnerSummaryForPrincipal(principal, row['summary']),
          })),
        });
        return;
      }
      sendJson(response, 400, { error: 'finance_view_invalid' });
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('allow', 'GET, POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return;
    }
    if (!requireSameOrigin(request, response)) return;
    const command = operationSchema.parse(suppliedCommand ?? (await readJsonObject(request)));
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    const shopId = command.shopId;
    const permission =
      command.type === 'finance.settlement.record' ||
      command.type === 'finance.cashier.reconcile' ||
      command.type === 'finance.day.finalize'
        ? 'finance.reconcile'
        : 'finance.adjust';
    requirePermission(principal, permission, shopId);
    if (
      command.type === 'finance.day.finalize' ||
      command.type === 'finance.snapshot.adjust' ||
      command.type === 'finance.owner-withdrawal'
    ) {
      requireRecentReauth(context.session, 300);
    }
    let result: Record<string, unknown>;
    if (command.type === 'finance.category.create') {
      if (command.scope === 'BUSINESS' && !['OWNER', 'ADMIN'].includes(principal.role)) {
        throw new AdminAuthorizationError('permission_forbidden');
      }
      result = await client.rpc('create_expense_category_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_scope_shop_id: command.scope === 'BUSINESS' ? null : shopId,
        p_name: command.name,
        p_command_id: command.commandId,
      });
    } else if (command.type === 'finance.recurring.rule') {
      result = await client.rpc('upsert_recurring_expense_rule_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_rule_id: command.ruleId,
        p_expected_version: command.expectedVersion,
        p_category_id: command.categoryId,
        p_description: command.description,
        p_amount_minor: command.amountMinor,
        p_cadence: command.cadence,
        p_next_due_date: command.nextDueDate,
        p_active: command.active,
        p_command_id: command.commandId,
      });
    } else if (command.type === 'finance.recurring.process') {
      result = await client.rpc('process_due_recurring_expenses_v2', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_until: cairoBusinessDate(),
        p_max_rules: 25,
      });
    } else if (command.type === 'finance.recurring.post') {
      result = await client.rpc('post_recurring_expense_occurrence_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_occurrence_id: command.occurrenceId,
        p_business_day_id: command.businessDayId,
        p_finance_account_id: command.accountId,
        p_reason: command.reason,
        p_command_id: command.commandId,
      });
    } else if (command.type === 'finance.cashier.reconcile') {
      result = await client.rpc('finance_reconcile_cashier_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_business_day_id: command.businessDayId,
        p_cashier_worker_id: command.cashierWorkerId,
        p_actual_minor: command.actualMinor,
        p_reason: command.reason,
        p_command_id: command.commandId,
      });
    } else if (command.type === 'finance.day.finalize') {
      result = await client.rpc('finance_finalize_day_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_business_day_id: command.businessDayId,
        p_command_id: command.commandId,
      });
    } else if (command.type === 'finance.snapshot.adjust') {
      result = await client.rpc('finance_adjust_snapshot_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_snapshot_id: command.snapshotId,
        p_amount_minor: command.amountMinor,
        p_reason: command.reason,
        p_command_id: command.commandId,
      });
    } else {
      const actionMap = {
        'finance.transfer': 'TRANSFER',
        'finance.bank-deposit': 'BANK_DEPOSIT',
        'finance.owner-contribution': 'OWNER_CONTRIBUTION',
        'finance.owner-withdrawal': 'OWNER_WITHDRAWAL',
        'finance.expense.post': 'EXPENSE',
        'finance.settlement.record': 'SETTLEMENT',
      } as const;
      const payload =
        command.type === 'finance.owner-contribution' || command.type === 'finance.owner-withdrawal'
          ? {
              fromAccountId: command.accountId,
              amountMinor: command.amountMinor,
              reason: command.reason,
            }
          : command.type === 'finance.expense.post'
            ? {
                fromAccountId: command.accountId,
                businessDayId: command.businessDayId,
                amountMinor: command.amountMinor,
                reason: command.reason,
                description: command.description,
                categoryId: command.categoryId,
                expenseDate: command.expenseDate,
                receiptReference: command.receiptReference,
              }
            : command;
      result = await client.rpc('execute_finance_management_v1', {
        p_actor_employee_id: principal.employeeId,
        p_shop_id: shopId,
        p_action: actionMap[command.type],
        p_payload: payload,
        p_command_id: command.commandId,
      });
    }
    sendCommandResponse(response, result);
  } catch (error) {
    errorResponse(response, error, request);
  }
}
