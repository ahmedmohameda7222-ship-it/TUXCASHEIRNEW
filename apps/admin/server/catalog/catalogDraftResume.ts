import type {
  AdminSessionPrincipal,
  CatalogDraftResumeResult,
  CatalogJsonObject,
  CatalogJsonValue,
  CatalogResumeDraftInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCatalogJsonValue(value: unknown): value is CatalogJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isCatalogJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isCatalogJsonValue);
}

function isCatalogJsonObject(value: unknown): value is CatalogJsonObject {
  return isRecord(value) && Object.values(value).every(isCatalogJsonValue);
}

function parseResult(value: unknown): CatalogDraftResumeResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    return { ok: false, code: 'invalid_request' };
  }
  if (value['ok'] === true) {
    if (
      typeof value['draftId'] !== 'string' ||
      typeof value['draftRevision'] !== 'number' ||
      typeof value['basePublishVersion'] !== 'number' ||
      !isCatalogJsonObject(value['bundleJson'])
    ) {
      return { ok: false, code: 'invalid_request' };
    }
    return {
      ok: true,
      draftId: value['draftId'],
      draftRevision: value['draftRevision'],
      basePublishVersion: value['basePublishVersion'],
      bundleJson: value['bundleJson'],
    };
  }
  if (value['code'] === 'stale_version' && typeof value['currentVersion'] === 'number') {
    return {
      ok: false,
      code: 'stale_version',
      message: 'The live catalog changed before the persisted draft could be resumed.',
      currentVersion: value['currentVersion'],
    };
  }
  if (
    value['code'] === 'invalid_request' ||
    value['code'] === 'draft_not_found' ||
    value['code'] === 'draft_not_editable'
  ) {
    return { ok: false, code: value['code'] };
  }
  return { ok: false, code: 'invalid_request' };
}

export async function resumeCatalogDraft(
  client: AdminSupabaseClient,
  input: CatalogResumeDraftInput,
  principal: AdminSessionPrincipal,
): Promise<CatalogDraftResumeResult> {
  requirePermission(principal, 'catalog.edit', input.shopId);
  const result = await client.rpc<unknown>('resume_catalog_draft_v1', {
    p_employee_id: principal.employeeId,
    p_shop_id: input.shopId,
    p_draft_id: input.draftId,
    p_expected_current_publish_version: input.expectedVersion,
  });
  return parseResult(result);
}
