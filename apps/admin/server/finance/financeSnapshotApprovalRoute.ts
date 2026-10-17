import type { AdminSessionContext } from '../adminAuthService.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestFinanceSnapshotAdjustment,
  type FinanceSnapshotApprovalResult,
} from '../approvals/financeSnapshotApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type FinanceSnapshotCommand = {
  shopId: string;
  snapshotId: string;
  amountMinor: number;
  reason: string;
  commandId: string;
  requesterPin?: string | undefined;
};

type TrustedFinancePreview =
  | {
      ok: true;
      businessId: string;
      shopId: string;
      snapshotId: string;
      expectedAdjustmentCount: number;
      approvalRequired: boolean;
      ruleId: string | null;
    }
  | { ok: false; code: string };

function isPreview(value: unknown): value is TrustedFinancePreview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (record['ok'] === false) return typeof record['code'] === 'string';
  return (
    record['ok'] === true &&
    typeof record['businessId'] === 'string' &&
    typeof record['shopId'] === 'string' &&
    typeof record['snapshotId'] === 'string' &&
    typeof record['approvalRequired'] === 'boolean' &&
    Number.isSafeInteger(record['expectedAdjustmentCount']) &&
    Number(record['expectedAdjustmentCount']) >= 0 &&
    (typeof record['ruleId'] === 'string' || record['ruleId'] === null)
  );
}

export async function executeFinanceSnapshotCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: FinanceSnapshotCommand,
  request: AdminRequest,
): Promise<FinanceSnapshotApprovalResult> {
  requirePermission(context.principal, 'finance.adjust', command.shopId);
  // Preview and the actual mutation rederive scope, threshold and revision on
  // the server. No client-supplied approval, threshold or adjustment count.
  const previewRaw = await client.rpc<unknown>('preview_admin_finance_snapshot_adjustment_v1', {
    p_actor_employee_id: context.principal.employeeId,
    p_shop_id: command.shopId,
    p_snapshot_id: command.snapshotId,
    p_amount_minor: command.amountMinor,
    p_reason: command.reason,
    p_command_id: command.commandId,
  });
  if (!isPreview(previewRaw)) return { ok: false, code: 'backend_contract_invalid' };
  if (!previewRaw.ok) return previewRaw;
  if (
    previewRaw.businessId !== context.principal.businessId ||
    previewRaw.shopId !== command.shopId ||
    previewRaw.snapshotId !== command.snapshotId
  ) {
    return { ok: false, code: 'finance_snapshot_scope_invalid' };
  }
  const deps = createSupabaseApprovalServiceDependencies(client);
  const matched =
    previewRaw.approvalRequired && previewRaw.ruleId !== null
      ? await deps.loadRule(previewRaw.ruleId)
      : null;
  if (previewRaw.approvalRequired && !matched) {
    return { ok: false, code: 'finance_snapshot_approval_rule_invalid' };
  }
  const payload = {
    shopId: command.shopId,
    snapshotId: command.snapshotId,
    amountMinor: command.amountMinor,
    reason: command.reason.trim(),
    commandId: command.commandId,
    expectedAdjustmentCount: previewRaw.expectedAdjustmentCount,
  };
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestFinanceSnapshotAdjustment(
    payload,
    { ...context.principal, sessionId: context.session.id },
    matched ? [matched] : [],
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
      client.rpc<FinanceSnapshotApprovalResult>('finance_adjust_snapshot_v1', {
        p_actor_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_snapshot_id: command.snapshotId,
        p_amount_minor: command.amountMinor,
        p_reason: command.reason,
        p_command_id: command.commandId,
      }),
  );
}
