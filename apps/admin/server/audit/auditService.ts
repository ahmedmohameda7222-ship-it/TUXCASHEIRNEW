import type { AppendAdminAuditEventInput } from '@tux/admin-contracts';

import type { AdminSupabaseClient } from '../supabaseAdmin';

const SECRET_KEY_PATTERN = /(^|_)(pin|password|passcode|verifier|salt|lookup)(_|$)/i;

function normalizeKey(key: string): string {
  return key.replace(/[-\s]+/g, '_');
}

function containsCredentialMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsCredentialMaterial);
  if (typeof value !== 'object' || value === null) return false;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(normalizeKey(key))) return true;
    if (containsCredentialMaterial(child)) return true;
  }
  return false;
}

export type AuditServiceDependencies = {
  append(input: AppendAdminAuditEventInput): Promise<string>;
};

export async function appendAuditEvent(
  input: AppendAdminAuditEventInput,
  deps: AuditServiceDependencies,
): Promise<string> {
  if (input.actionType.trim() === '') throw new Error('admin_audit_action_required');
  if (
    containsCredentialMaterial(input.beforeValue) ||
    containsCredentialMaterial(input.afterValue) ||
    containsCredentialMaterial(input.contextMetadata)
  ) {
    throw new Error('admin_audit_credential_material_forbidden');
  }
  return deps.append({
    ...input,
    actionType: input.actionType.trim(),
    entityType: input.entityType?.trim() || null,
    entityId: input.entityId?.trim() || null,
    reason: input.reason?.trim() || null,
    contextMetadata: input.contextMetadata ?? {},
  });
}

export function createSupabaseAuditServiceDependencies(
  client: AdminSupabaseClient,
): AuditServiceDependencies {
  return {
    async append(input) {
      const result = await client.rpc<unknown>('append_admin_audit_event_v1', {
        p_business_id: input.businessId,
        p_shop_id: input.shopId ?? null,
        p_actor_employee_id: input.actorEmployeeId ?? null,
        p_action_type: input.actionType,
        p_entity_type: input.entityType ?? null,
        p_entity_id: input.entityId ?? null,
        p_before_value: input.beforeValue ?? null,
        p_after_value: input.afterValue ?? null,
        p_reason: input.reason ?? null,
        p_approval_request_id: input.approvalRequestId ?? null,
        p_session_id: input.sessionId ?? null,
        p_context_metadata: input.contextMetadata ?? {},
      });
      if (typeof result !== 'string' || result.trim() === '') {
        throw new Error('admin_audit_backend_contract_invalid');
      }
      return result;
    },
  };
}
