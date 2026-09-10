import type {
  AdminSessionPrincipal,
  CatalogDraftSaveResult,
  CatalogImmediateAvailabilityInput,
  CatalogImmediateAvailabilityResult,
  CatalogJsonObject,
  CatalogPublishDraftInput,
  CatalogPublishResult,
  CatalogSaveDraftInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import { AdminSupabaseClient } from '../supabaseAdmin';

export class CatalogServiceError extends Error {
  constructor(readonly code: 'invalid_change_set' | 'backend_contract_invalid') {
    super(code);
    this.name = 'CatalogServiceError';
  }
}

type StorePublishResult =
  | Exclude<CatalogPublishResult, { ok: false; code: 'stale_version' }>
  | { ok: false; code: 'stale_version'; currentVersion: number };

export interface CatalogStore {
  getCurrentPublishVersion(shopId: string): Promise<number>;
  saveDraftChange(input: {
    employeeId: string;
    draftId: string;
    expectedDraftRevision: number;
    changeJson: CatalogJsonObject;
  }): Promise<CatalogDraftSaveResult>;
  publishDraft(input: {
    employeeId: string;
    draftId: string;
    expectedDraftRevision: number;
    expectedVersion: number;
  }): Promise<StorePublishResult>;
  setImmediateAvailability(input: {
    employeeId: string;
    shopId: string;
    productId: string;
    soldOut: boolean;
  }): Promise<CatalogImmediateAvailabilityResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRpcResult<T>(value: unknown): T {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') {
    throw new CatalogServiceError('backend_contract_invalid');
  }
  return value as T;
}

function readVersion(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new CatalogServiceError('backend_contract_invalid');
  }
  return numeric;
}

function deepContainsPriceField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(deepContainsPriceField);
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'priceMinor' || key === 'price_minor') return true;
    if (deepContainsPriceField(child)) return true;
  }
  return false;
}

function changeTouchesPricing(input: CatalogSaveDraftInput): boolean {
  return input.changes.some((change) => {
    if (change.changedPaths !== undefined) {
      return change.changedPaths.some((path) => /(^|[.\[/])(priceMinor|price_minor)([.\]/]|$)/.test(path));
    }
    // Conservative fallback for older clients. The database independently compares prices
    // against the locked draft/canonical rows, so changedPaths never grants authority.
    return deepContainsPriceField(change.bundleJson);
  });
}

function singleBundleChange(input: CatalogSaveDraftInput): CatalogJsonObject {
  if (input.changes.length !== 1 || input.changes[0]?.kind !== 'bundle.replace') {
    throw new CatalogServiceError('invalid_change_set');
  }
  const change = input.changes[0];
  return {
    bundleJson: change.bundleJson,
    ...(change.changedPaths === undefined ? {} : { changedPaths: change.changedPaths }),
  };
}

function staleVersion(currentVersion: number): CatalogPublishResult {
  return {
    ok: false,
    code: 'stale_version',
    message: 'Catalog changed since this draft was opened. Refresh the draft before publishing.',
    currentVersion,
  };
}

export function createCatalogService(store: CatalogStore) {
  return {
    async saveCatalogDraftChange(
      input: CatalogSaveDraftInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogDraftSaveResult> {
      requirePermission(principal, 'catalog.edit', input.shopId);
      if (changeTouchesPricing(input)) {
        requirePermission(principal, 'catalog.pricing', input.shopId);
      }
      const changeJson = singleBundleChange(input);
      return store.saveDraftChange({
        employeeId: principal.employeeId,
        draftId: input.draftId,
        expectedDraftRevision: input.expectedDraftRevision,
        changeJson,
      });
    },

    async publishCatalogDraft(
      input: CatalogPublishDraftInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogPublishResult> {
      requirePermission(principal, 'catalog.publish', input.shopId);
      const currentVersion = await store.getCurrentPublishVersion(input.shopId);
      if (currentVersion !== input.expectedVersion) return staleVersion(currentVersion);

      const result = await store.publishDraft({
        employeeId: principal.employeeId,
        draftId: input.draftId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedVersion: input.expectedVersion,
      });
      if (!result.ok && result.code === 'stale_version') {
        return staleVersion(result.currentVersion);
      }
      return result;
    },

    async setImmediateAvailability(
      input: CatalogImmediateAvailabilityInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogImmediateAvailabilityResult> {
      requirePermission(principal, 'catalog.edit', input.shopId);
      return store.setImmediateAvailability({
        employeeId: principal.employeeId,
        shopId: input.shopId,
        productId: input.productId,
        soldOut: input.soldOut,
      });
    },
  };
}

export function createSupabaseCatalogStore(client: AdminSupabaseClient): CatalogStore {
  return {
    async getCurrentPublishVersion(shopId) {
      const rows = await client.select<Array<{ publish_version: number | string }>>(
        'catalog_publish_versions',
        new URLSearchParams({
          select: 'publish_version',
          shop_id: `eq.${shopId}`,
          order: 'publish_version.desc',
          limit: '1',
        }),
      );
      return rows.length === 0 ? 0 : readVersion(rows[0]?.publish_version);
    },

    async saveDraftChange(input) {
      const result = await client.rpc<unknown>('apply_catalog_draft_change_v1', {
        p_employee_id: input.employeeId,
        p_draft_id: input.draftId,
        p_expected_draft_revision: input.expectedDraftRevision,
        p_change_json: input.changeJson,
      });
      return requireRpcResult<CatalogDraftSaveResult>(result);
    },

    async publishDraft(input) {
      const result = await client.rpc<unknown>('publish_catalog_draft_v1', {
        p_employee_id: input.employeeId,
        p_draft_id: input.draftId,
        p_expected_draft_revision: input.expectedDraftRevision,
        p_expected_base_publish_version: input.expectedVersion,
      });
      return requireRpcResult<StorePublishResult>(result);
    },

    async setImmediateAvailability(input) {
      const result = await client.rpc<unknown>('set_immediate_product_availability_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_product_id: input.productId,
        p_sold_out: input.soldOut,
      });
      return requireRpcResult<CatalogImmediateAvailabilityResult>(result);
    },
  };
}
