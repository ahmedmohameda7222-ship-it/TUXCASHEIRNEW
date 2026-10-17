import type {
  AdminApprovalRule,
  AdminPermission,
  CatalogPublishResult,
} from '@tux/admin-contracts';

import type { AdminSessionContext } from '../adminAuthService.js';
import { isAdminPermission } from '../adminContractRuntime.js';
import { requirePermission } from '../authorization.js';
import { getAdminServerEnv } from '../env.js';
import { clientFingerprint, type AdminRequest } from '../http.js';
import { createAdminPinRateLimitRpc } from '../loginRateLimit.js';
import { verifyApprovalPinWithRateLimit } from '../approvals/approvalPinRateLimit.js';
import { createSupabaseApprovalServiceDependencies } from '../approvals/approvalService.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import {
  CATALOG_PRICE_PUBLISH_ACTION,
  executeOrRequestCatalogPricePublish,
  type CatalogPricePublishApprovalResult,
} from './catalogPricePublishApproval.js';

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

type CatalogPricePreview =
  | { ok: true; shopId: string; maxPriceDeltaMinor: number; candidateFingerprint: string }
  | { ok: false; code: string; currentVersion?: number; currentDraftRevision?: number };

export async function executeCatalogPricePublish(
  client: AdminSupabaseClient,
  context: AdminSessionContext,
  command: {
    shopId: string;
    draftId: string;
    expectedDraftRevision: number;
    expectedVersion: number;
    requesterPin?: string;
  },
  request: AdminRequest,
): Promise<CatalogPricePublishApprovalResult> {
  const actor = context.principal;
  requirePermission(actor, 'catalog.publish', command.shopId);
  const preview = await client.rpc<CatalogPricePreview>('preview_admin_catalog_price_publish_v1', {
    p_employee_id: actor.employeeId,
    p_draft_id: command.draftId,
    p_expected_draft_revision: command.expectedDraftRevision,
    p_expected_publish_version: command.expectedVersion,
  });
  if (!preview.ok) return preview;
  if (
    preview.shopId !== command.shopId ||
    !Number.isSafeInteger(preview.maxPriceDeltaMinor) ||
    preview.maxPriceDeltaMinor < 0 ||
    !/^[a-f0-9]{32}$/.test(preview.candidateFingerprint)
  ) {
    return { ok: false, code: 'catalog_price_preview_invalid' };
  }
  const ruleRows = await client.select<RuleRow[]>(
    'admin_approval_rules',
    new URLSearchParams({
      select:
        'id,business_id,shop_id,action_type,requester_permission,approver_permission,requires_second_person,requires_requester_repin,threshold_context,active',
      business_id: `eq.${actor.businessId}`,
      action_type: `eq.${CATALOG_PRICE_PUBLISH_ACTION}`,
      active: 'eq.true',
    }),
  );
  const rules: AdminApprovalRule[] = ruleRows.map((row) => {
    if (
      !isAdminPermission(row.requester_permission) ||
      !isAdminPermission(row.approver_permission)
    ) {
      throw new Error('catalog_price_approval_rule_permission_invalid');
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
  const base = createSupabaseApprovalServiceDependencies(client);
  const limiter = createAdminPinRateLimitRpc(client);
  return executeOrRequestCatalogPricePublish(
    {
      shopId: command.shopId,
      draftId: command.draftId,
      expectedDraftRevision: command.expectedDraftRevision,
      expectedVersion: command.expectedVersion,
      maxPriceDeltaMinor: preview.maxPriceDeltaMinor,
      candidateFingerprint: preview.candidateFingerprint,
    },
    { ...actor, sessionId: context.session.id },
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
      client.rpc<CatalogPublishResult>('publish_catalog_draft_v1', {
        p_employee_id: actor.employeeId,
        p_draft_id: command.draftId,
        p_expected_draft_revision: command.expectedDraftRevision,
        p_expected_base_publish_version: command.expectedVersion,
      }),
  );
}
