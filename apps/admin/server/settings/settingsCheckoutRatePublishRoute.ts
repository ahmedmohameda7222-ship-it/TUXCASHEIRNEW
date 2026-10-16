import type {
  AdminApprovalRule,
  AdminPermission,
} from '@tux/admin-contracts';

import type { AdminSessionContext } from '../adminAuthService.js';
import { isAdminPermission } from '../adminContractRuntime.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import {
  executeOrRequestSettingsCheckoutRatePublish,
  SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION,
  type SettingsCheckoutRatePublishResult,
} from '../approvals/settingsCheckoutRatePublishApproval.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import { createSettingsService, createSupabaseSettingsStore } from './settingsService.js';

type RuleRow = {
  id: string;
  business_id: string;
  shop_id: string | null;
  action_type: string;
  requester_permission: string;
  approver_permission: string;
  requires_second_person: boolean;
  requires_requester_repin: boolean;
  threshold_context: unknown;
  active: boolean;
};
type RatePreview =
  | { ok: true; ratesChanged: boolean; payloadFingerprint: string }
  | { ok: false; code: string; currentVersion?: number };

export async function executeSettingsCheckoutRatePublish(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: { shopId: string; expectedSettingsVersion: number; requesterPin?: string },
  request: AdminRequest,
): Promise<SettingsCheckoutRatePublishResult> {
  const principal = context.principal;
  requirePermission(principal, 'settings.manage', command.shopId);
  const preview = await client.rpc<RatePreview>('preview_admin_checkout_rate_publish_v1', {
    p_employee_id: principal.employeeId,
    p_shop_id: command.shopId,
    p_expected_settings_version: command.expectedSettingsVersion,
  });
  if (!preview.ok) return preview;
  if (!/^[a-f0-9]{32}$/.test(preview.payloadFingerprint) || typeof preview.ratesChanged !== 'boolean') {
    return { ok: false, code: 'checkout_rate_preview_invalid' };
  }
  const rows = await client.select<RuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${principal.businessId}`,
      action_type: `eq.${SETTINGS_CHECKOUT_RATE_PUBLISH_ACTION}`,
      active: 'eq.true',
    }),
  );
  const rules: AdminApprovalRule[] = rows.map((row) => {
    if (!isAdminPermission(row.requester_permission) || !isAdminPermission(row.approver_permission)) {
      throw new Error('checkout_rate_approval_rule_permission_invalid');
    }
    return {
      id: row.id,
      businessId: row.business_id,
      shopId: row.shop_id,
      actionType: row.action_type,
      requesterPermission: row.requester_permission as AdminPermission,
      approverPermission: row.approver_permission as AdminPermission,
      requiresSecondPerson: row.requires_second_person,
      requiresRequesterRepin: row.requires_requester_repin,
      thresholdContext:
        typeof row.threshold_context === 'object' &&
        row.threshold_context !== null &&
        !Array.isArray(row.threshold_context)
          ? (row.threshold_context as Readonly<Record<string, unknown>>)
          : {},
      active: row.active,
    };
  });
  const actor = { ...principal, sessionId: context.session.id };
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestSettingsCheckoutRatePublish(
    {
      shopId: command.shopId,
      expectedSettingsVersion: command.expectedSettingsVersion,
      payloadFingerprint: preview.payloadFingerprint,
    },
    preview.ratesChanged,
    actor,
    rules,
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
      createSettingsService(createSupabaseSettingsStore(client)).publishSettings(
        command.shopId, command.expectedSettingsVersion, principal,
      ),
  );
}
