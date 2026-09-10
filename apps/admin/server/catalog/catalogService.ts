import type {
  AdminSessionPrincipal,
  CatalogCreateDraftInput,
  CatalogDraftCreateResult,
  CatalogDraftSaveResult,
  CatalogDraftStatus,
  CatalogDraftSummary,
  CatalogImmediateAvailabilityInput,
  CatalogImmediateAvailabilityResult,
  CatalogJsonObject,
  CatalogProductDetail,
  CatalogPublishDraftInput,
  CatalogPublishResult,
  CatalogSaveDraftInput,
  CatalogWorkspace,
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
type StoreCreateDraftResult =
  | Exclude<CatalogDraftCreateResult, { ok: false; code: 'stale_version' }>
  | { ok: false; code: 'stale_version'; currentVersion: number };

export interface CatalogStore {
  getCurrentPublishVersion(shopId: string): Promise<number>;
  loadWorkspace(shopId: string, businessId: string): Promise<CatalogWorkspace>;
  createDraft(input: {
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    title?: string;
  }): Promise<StoreCreateDraftResult>;
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

type ProductRow = {
  id: string;
  shop_id: string;
  category_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  price_minor: number | string;
  image_key: string | null;
  family: string | null;
  best_seller: boolean;
  active: boolean;
  sold_out: boolean;
  is_combo: boolean;
  sort_order: number;
};

type DraftRow = {
  id: string;
  shop_id: string;
  title: string | null;
  status: string;
  base_publish_version: number | string;
  draft_revision: number | string;
  published_version: number | string | null;
  updated_at: string;
};

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

function readDraftStatus(value: string): CatalogDraftStatus {
  if (value === 'DRAFT' || value === 'PUBLISHED' || value === 'DISCARDED') return value;
  throw new CatalogServiceError('backend_contract_invalid');
}

function mapProduct(row: ProductRow): CatalogProductDetail {
  return {
    id: row.id,
    shopId: row.shop_id,
    categoryId: row.category_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    priceMinor: readVersion(row.price_minor),
    imageKey: row.image_key,
    family: row.family,
    bestSeller: row.best_seller,
    active: row.active,
    soldOut: row.sold_out,
    isCombo: row.is_combo,
    sortOrder: row.sort_order,
  };
}

function mapDraft(row: DraftRow): CatalogDraftSummary {
  return {
    id: row.id,
    shopId: row.shop_id,
    title: row.title,
    status: readDraftStatus(row.status),
    basePublishVersion: readVersion(row.base_publish_version),
    draftRevision: readVersion(row.draft_revision),
    publishedVersion: row.published_version === null ? null : readVersion(row.published_version),
    updatedAt: row.updated_at,
  };
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
      return change.changedPaths.some((path) =>
        /(^|[.\[/])(priceMinor|price_minor)([.\]/]|$)/.test(path),
      );
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

function staleVersion(currentVersion: number): CatalogPublishResult & CatalogDraftCreateResult {
  return {
    ok: false,
    code: 'stale_version',
    message: 'Catalog changed since this version was loaded. Refresh before continuing.',
    currentVersion,
  };
}

export function createCatalogService(store: CatalogStore) {
  return {
    async loadCatalogWorkspace(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogWorkspace> {
      requirePermission(principal, 'catalog.view', shopId);
      return store.loadWorkspace(shopId, principal.businessId);
    },

    async createCatalogDraft(
      input: CatalogCreateDraftInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogDraftCreateResult> {
      requirePermission(principal, 'catalog.edit', input.shopId);
      const currentVersion = await store.getCurrentPublishVersion(input.shopId);
      if (currentVersion !== input.expectedVersion) return staleVersion(currentVersion);
      const result = await store.createDraft({
        employeeId: principal.employeeId,
        shopId: input.shopId,
        expectedVersion: input.expectedVersion,
        ...(input.title === undefined ? {} : { title: input.title }),
      });
      if (!result.ok && result.code === 'stale_version') return staleVersion(result.currentVersion);
      return result;
    },

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

async function loadCurrentPublishVersion(
  client: AdminSupabaseClient,
  shopId: string,
): Promise<number> {
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
}

export function createSupabaseCatalogStore(client: AdminSupabaseClient): CatalogStore {
  return {
    getCurrentPublishVersion(shopId) {
      return loadCurrentPublishVersion(client, shopId);
    },

    async loadWorkspace(shopId, businessId) {
      const [currentPublishVersion, products, drafts] = await Promise.all([
        loadCurrentPublishVersion(client, shopId),
        client.select<ProductRow[]>(
          'products',
          new URLSearchParams({
            select:
              'id,shop_id,category_id,slug,name,description,price_minor,image_key,family,best_seller,active,sold_out,is_combo,sort_order',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
        client.select<DraftRow[]>(
          'catalog_drafts',
          new URLSearchParams({
            select:
              'id,shop_id,title,status,base_publish_version,draft_revision,published_version,updated_at',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'updated_at.desc',
            limit: '50',
          }),
        ),
      ]);

      return {
        shopId,
        currentPublishVersion,
        products: products.map(mapProduct),
        drafts: drafts.map(mapDraft),
      };
    },

    async createDraft(input) {
      const result = await client.rpc<unknown>('create_catalog_draft_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_expected_base_publish_version: input.expectedVersion,
        p_title: input.title ?? null,
      });
      return requireRpcResult<StoreCreateDraftResult>(result);
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
