import type { AdminSessionContext } from '../adminAuthService.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestOwnerWithdrawal,
  type OwnerWithdrawalResult,
} from '../approvals/financeOwnerWithdrawalApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type Command = {
  shopId: string;
  accountId: string;
  amountMinor: number;
  reason: string;
  commandId: string;
  requesterPin?: string | undefined;
};

type Preview =
  | {
      ok: true;
      businessId: string;
      shopId: string;
      accountId: string;
      approvalRequired: boolean;
      ruleId: string | null;
    }
  | { ok: false; code: string };

function parsePreview(input: unknown): Preview | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Readonly<Record<string, unknown>>;
  if (value['ok'] === false && typeof value['code'] === 'string') {
    return { ok: false, code: value['code'] };
  }
  if (
    value['ok'] !== true ||
    typeof value['businessId'] !== 'string' ||
    typeof value['shopId'] !== 'string' ||
    typeof value['accountId'] !== 'string' ||
    typeof value['approvalRequired'] !== 'boolean' ||
    !(typeof value['ruleId'] === 'string' || value['ruleId'] === null)
  )
    return null;
  return {
    ok: true,
    businessId: value['businessId'],
    shopId: value['shopId'],
    accountId: value['accountId'],
    approvalRequired: value['approvalRequired'],
    ruleId: value['ruleId'],
  };
}

export async function executeOwnerWithdrawalCommand(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: Command,
  request: AdminRequest,
): Promise<OwnerWithdrawalResult> {
  requirePermission(context.principal, 'finance.adjust', command.shopId);
  const raw = await client.rpc<unknown>('preview_admin_finance_owner_withdrawal_v1', {
    p_actor_employee_id: context.principal.employeeId,
    p_shop_id: command.shopId,
    p_account_id: command.accountId,
    p_amount_minor: command.amountMinor,
    p_reason: command.reason,
    p_command_id: command.commandId,
  });
  const preview = parsePreview(raw);
  if (!preview) return { ok: false, code: 'backend_contract_invalid' };
  if (!preview.ok) return preview;
  if (
    preview.businessId !== context.principal.businessId ||
    preview.shopId !== command.shopId ||
    preview.accountId !== command.accountId
  ) {
    return { ok: false, code: 'finance_owner_withdrawal_scope_invalid' };
  }
  const base = createSupabaseApprovalServiceDependencies(client);
  const rule =
    preview.ruleId && preview.approvalRequired ? await base.loadRule(preview.ruleId) : null;
  if (preview.approvalRequired && !rule) {
    return { ok: false, code: 'finance_owner_withdrawal_rule_invalid' };
  }
  const limiter = createAdminPinRateLimitRpc(client);
  const payload = {
    shopId: command.shopId,
    accountId: command.accountId,
    amountMinor: command.amountMinor,
    reason: command.reason.trim(),
    commandId: command.commandId,
  };
  return executeOrRequestOwnerWithdrawal(
    payload,
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
      client.rpc<OwnerWithdrawalResult>('execute_finance_management_v1', {
        p_actor_employee_id: context.principal.employeeId,
        p_shop_id: command.shopId,
        p_action: 'OWNER_WITHDRAWAL',
        p_payload: {
          fromAccountId: command.accountId,
          amountMinor: command.amountMinor,
          reason: command.reason,
        },
        p_command_id: command.commandId,
      }),
  );
}
