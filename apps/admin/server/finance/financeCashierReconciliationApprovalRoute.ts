import type { AdminSessionContext } from '../adminAuthService.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestCashierReconciliation,
  type CashierReconciliationResult,
  type CashierReconciliationMutationResult,
} from '../approvals/financeCashierReconciliationApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type Command = {
  shopId: string;
  businessDayId: string;
  cashierWorkerId: string;
  actualMinor: number;
  reason: string | null;
  commandId: string;
  requesterPin?: string | undefined;
};

type TrustedPreview =
  | {
      ok: true;
      businessId: string;
      shopId: string;
      businessDayId: string;
      cashierWorkerId: string;
      expectedMinor: number;
      varianceMinor: number;
      approvalRequired: boolean;
      ruleId: string | null;
    }
  | { ok: false; code: string };

function validatePreview(input: unknown): TrustedPreview | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const v = input as Readonly<Record<string, unknown>>;
  if (v['ok'] === false && typeof v['code'] === 'string') {
    return { ok: false, code: v['code'] };
  }
  if (
    v['ok'] !== true ||
    typeof v['businessId'] !== 'string' ||
    typeof v['shopId'] !== 'string' ||
    typeof v['businessDayId'] !== 'string' ||
    typeof v['cashierWorkerId'] !== 'string' ||
    typeof v['expectedMinor'] !== 'number' ||
    !Number.isSafeInteger(v['expectedMinor']) ||
    typeof v['varianceMinor'] !== 'number' ||
    !Number.isSafeInteger(v['varianceMinor']) ||
    v['varianceMinor'] < 0 ||
    typeof v['approvalRequired'] !== 'boolean' ||
    !(v['ruleId'] === null || typeof v['ruleId'] === 'string')
  ) {
    return null;
  }
  return {
    ok: true,
    businessId: v['businessId'],
    shopId: v['shopId'],
    businessDayId: v['businessDayId'],
    cashierWorkerId: v['cashierWorkerId'],
    expectedMinor: v['expectedMinor'],
    varianceMinor: v['varianceMinor'],
    approvalRequired: v['approvalRequired'],
    ruleId: v['ruleId'],
  };
}

export async function executeCashierReconciliationCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: Command,
  request: AdminRequest,
): Promise<CashierReconciliationResult> {
  requirePermission(context.principal, 'finance.reconcile', command.shopId);
  const raw = await client.rpc<unknown>('preview_admin_finance_cashier_reconciliation_v1', {
    p_actor_employee_id: context.principal.employeeId,
    p_shop_id: command.shopId,
    p_business_day_id: command.businessDayId,
    p_cashier_worker_id: command.cashierWorkerId,
    p_actual_minor: command.actualMinor,
    p_reason: command.reason,
    p_command_id: command.commandId,
  });
  const preview = validatePreview(raw);
  if (!preview) return { ok: false, code: 'backend_contract_invalid' };
  if (!preview.ok) return preview;
  if (
    preview.businessId !== context.principal.businessId ||
    preview.shopId !== command.shopId ||
    preview.businessDayId !== command.businessDayId ||
    preview.cashierWorkerId !== command.cashierWorkerId ||
    Math.abs(command.actualMinor - preview.expectedMinor) !== preview.varianceMinor
  ) {
    return { ok: false, code: 'finance_cashier_preview_scope_invalid' };
  }
  const base = createSupabaseApprovalServiceDependencies(client);
  const rule =
    preview.approvalRequired && preview.ruleId
      ? await base.loadRule(preview.ruleId)
      : null;
  if (preview.approvalRequired && !rule) {
    return { ok: false, code: 'finance_cashier_rule_invalid' };
  }
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestCashierReconciliation(
    {
      shopId: command.shopId,
      businessDayId: command.businessDayId,
      cashierWorkerId: command.cashierWorkerId,
      actualMinor: command.actualMinor,
      expectedMinor: preview.expectedMinor,
      reason: command.reason?.trim() || null,
      commandId: command.commandId,
    },
    preview.varianceMinor,
    { ...context.principal, sessionId: context.session.id },
    rule ? [rule] : [],
    {
      ...base,
      verifyEmployeePin(employeeId, pin) {
        return verifyApprovalPinWithRateLimit(
          {
            employeeId,
            sessionId: context.session.id,
            pin,
            fingerprint: clientFingerprint(request),
            rateLimitSecret: getAdminServerEnv().rateLimitSecret,
          },
          { verifyEmployeePin: base.verifyEmployeePin, limiter },
        );
      },
    },
    command.requesterPin,
    () =>
      client.rpc<CashierReconciliationMutationResult>('finance_reconcile_cashier_v1', {
        p_actor_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_business_day_id: command.businessDayId,
        p_cashier_worker_id: command.cashierWorkerId,
        p_actual_minor: command.actualMinor,
        p_reason: command.reason,
        p_command_id: command.commandId,
      }),
  );
}
