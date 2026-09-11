import type {
  AdminSessionPrincipal,
  CatalogCancelScheduleInput,
  CatalogCancelScheduleResult,
  CatalogCategorySummary,
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
  CatalogPublishingWorkspace,
  CatalogPublishPreview,
  CatalogPublishResult,
  CatalogPublishSourceKind,
  CatalogPublishVersionSummary,
  CatalogRestoreVersionInput,
  CatalogRestoreVersionResult,
  CatalogSaveDraftInput,
  CatalogScheduledChangeSummary,
  CatalogScheduleDraftInput,
  CatalogScheduleResult,
  CatalogScheduleStatus,
  CatalogWorkspace,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization';
import type { AdminSupabaseClient } from '../supabaseAdmin';

export class CatalogServiceError extends Error {
  constructor(
    readonly code:
      | 'invalid_change_set'
      | 'backend_contract_invalid'
      | 'invalid_scheduled_time',
  ) {
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
type StoreRestoreResult =
  | Exclude<CatalogRestoreVersionResult, { ok: false; code: 'stale_version' }>
  | { ok: false; code: 'stale_version'; currentVersion: number };
type StoreScheduleResult =
  | Exclude<CatalogScheduleResult, { ok: false; code: 'stale_version' }>
  | { ok: false; code: 'stale_version'; currentVersion: number };

export interface CatalogStore {
  getCurrentPublishVersion(shopId: string): Promise<number>;
  loadWorkspace(shopId: string, businessId: string): Promise<CatalogWorkspace>;
  loadPublishing(shopId: string, businessId: string): Promise<CatalogPublishingWorkspace>;
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
  restoreVersion(input: {
    employeeId: string;
    shopId: string;
    sourcePublishVersion: number;
    expectedVersion: number;
  }): Promise<StoreRestoreResult>;
  scheduleDraft(input: {
    employeeId: string;
    draftId: string;
    expectedDraftRevision: number;
    expectedVersion: number;
    localScheduledAt: string;
  }): Promise<StoreScheduleResult>;
  cancelSchedule(input: {
    employeeId: string;
    shopId: string;
    scheduleId: string;
  }): Promise<CatalogCancelScheduleResult>;
}

type CategoryRow = {
  id: string;
  shop_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  sort_order: number;
  active: boolean;
};

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

type PublishingDraftRow = {
  id: string;
  shop_id: string;
  base_publish_version: number | string;
  draft_revision: number | string;
  working_bundle_json: unknown;
};

type PublishVersionRow = {
  shop_id: string;
  publish_version: number | string;
  operations_configuration_version: number | string;
  source_kind: string;
  draft_id: string | null;
  published_by_employee_id: string | null;
  restored_from_publish_version: number | string | null;
  published_at: string;
};

type ScheduledChangeRow = {
  id: string;
  shop_id: string;
  payload_json: unknown;
  status: string;
  timezone: string;
  local_scheduled_at: string;
  scheduled_for: string;
  target_base_publish_version: number | string | null;
  attempt_count: number | string;
  last_error: string | null;
};

type ComparableProduct = {
  categoryId: string;
  slug: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
  imageKey: string | null;
  family: string | null;
  bestSeller: boolean;
  active: boolean;
  soldOut: boolean;
  isCombo: boolean;
  sortOrder: number;
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

function readPublishSourceKind(value: string): CatalogPublishSourceKind {
  if (
    value === 'BASELINE' ||
    value === 'DRAFT' ||
    value === 'IMMEDIATE_AVAILABILITY' ||
    value === 'SCHEDULE' ||
    value === 'ROLLBACK'
  ) {
    return value;
  }
  throw new CatalogServiceError('backend_contract_invalid');
}

function readScheduleStatus(value: string): CatalogScheduleStatus {
  if (
    value === 'PENDING' ||
    value === 'CLAIMED' ||
    value === 'APPLIED' ||
    value === 'FAILED' ||
    value === 'CANCELLED'
  ) {
    return value;
  }
  throw new CatalogServiceError('backend_contract_invalid');
}

function readNonemptyString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CatalogServiceError('backend_contract_invalid');
  }
  return value;
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new CatalogServiceError('backend_contract_invalid');
  return value;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new CatalogServiceError('backend_contract_invalid');
  return value;
}

function mapCategory(row: CategoryRow): CatalogCategorySummary {
  return {
    id: row.id,
    shopId: row.shop_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    active: row.active,
  };
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

function mapPublishVersion(row: PublishVersionRow): CatalogPublishVersionSummary {
  return {
    shopId: row.shop_id,
    publishVersion: readVersion(row.publish_version),
    operationsConfigurationVersion: readVersion(row.operations_configuration_version),
    sourceKind: readPublishSourceKind(row.source_kind),
    draftId: row.draft_id,
    publishedByEmployeeId: row.published_by_employee_id,
    restoredFromPublishVersion:
      row.restored_from_publish_version === null
        ? null
        : readVersion(row.restored_from_publish_version),
    publishedAt: readNonemptyString(row.published_at),
  };
}

function schedulePayload(row: ScheduledChangeRow): {
  draftId: string | null;
  expectedDraftRevision: number | null;
} {
  if (!isRecord(row.payload_json)) return { draftId: null, expectedDraftRevision: null };
  const draftId = typeof row.payload_json['draftId'] === 'string' ? row.payload_json['draftId'] : null;
  const revision = row.payload_json['expectedDraftRevision'];
  return {
    draftId,
    expectedDraftRevision: revision === undefined || revision === null ? null : readVersion(revision),
  };
}

function mapScheduledChange(row: ScheduledChangeRow): CatalogScheduledChangeSummary {
  if (row.timezone !== 'Africa/Cairo') throw new CatalogServiceError('backend_contract_invalid');
  const payload = schedulePayload(row);
  return {
    id: row.id,
    shopId: row.shop_id,
    draftId: payload.draftId,
    expectedDraftRevision: payload.expectedDraftRevision,
    status: readScheduleStatus(row.status),
    timezone: 'Africa/Cairo',
    localScheduledAt: readNonemptyString(row.local_scheduled_at),
    scheduledFor: readNonemptyString(row.scheduled_for),
    targetBasePublishVersion:
      row.target_base_publish_version === null
        ? null
        : readVersion(row.target_base_publish_version),
    attemptCount: readVersion(row.attempt_count),
    lastError: row.last_error,
  };
}

function comparableLiveProduct(product: CatalogProductDetail): ComparableProduct {
  return {
    categoryId: product.categoryId,
    slug: product.slug,
    name: product.name,
    description: product.description,
    priceMinor: product.priceMinor,
    imageKey: product.imageKey,
    family: product.family,
    bestSeller: product.bestSeller,
    active: product.active,
    soldOut: product.soldOut,
    isCombo: product.isCombo,
    sortOrder: product.sortOrder,
  };
}

function comparableDraftProduct(value: unknown): { id: string; product: ComparableProduct } {
  if (!isRecord(value)) throw new CatalogServiceError('backend_contract_invalid');
  return {
    id: readNonemptyString(value['id']),
    product: {
      categoryId: readNonemptyString(value['categoryId']),
      slug: readNullableString(value['slug']),
      name: readNonemptyString(value['name']),
      description: readNullableString(value['description']),
      priceMinor: readVersion(value['priceMinor']),
      imageKey: readNullableString(value['imageKey']),
      family: readNullableString(value['family']),
      bestSeller: readBoolean(value['bestSeller']),
      active: readBoolean(value['active']),
      soldOut: readBoolean(value['soldOut']),
      isCombo: readBoolean(value['isCombo']),
      sortOrder: readVersion(value['sortOrder']),
    },
  };
}

function readDraftBundleProducts(bundle: unknown): Map<string, ComparableProduct> {
  if (!isRecord(bundle) || !isRecord(bundle['snapshot']) || !Array.isArray(bundle['snapshot']['products'])) {
    throw new CatalogServiceError('backend_contract_invalid');
  }

  const products = new Map<string, ComparableProduct>();
  for (const rawProduct of bundle['snapshot']['products']) {
    const parsed = comparableDraftProduct(rawProduct);
    if (products.has(parsed.id)) throw new CatalogServiceError('backend_contract_invalid');
    products.set(parsed.id, parsed.product);
  }
  return products;
}

function productsEqual(a: ComparableProduct, b: ComparableProduct): boolean {
  return (
    a.categoryId === b.categoryId &&
    a.slug === b.slug &&
    a.name === b.name &&
    a.description === b.description &&
    a.priceMinor === b.priceMinor &&
    a.imageKey === b.imageKey &&
    a.family === b.family &&
    a.bestSeller === b.bestSeller &&
    a.active === b.active &&
    a.soldOut === b.soldOut &&
    a.isCombo === b.isCombo &&
    a.sortOrder === b.sortOrder
  );
}

function buildPublishPreview(
  row: PublishingDraftRow,
  currentPublishVersion: number,
  liveProducts: readonly CatalogProductDetail[],
): CatalogPublishPreview {
  const draftProducts = readDraftBundleProducts(row.working_bundle_json);
  const liveById = new Map(liveProducts.map((product) => [product.id, comparableLiveProduct(product)]));
  const allIds = [...new Set([...liveById.keys(), ...draftProducts.keys()])].sort();
  const changedProductIds: string[] = [];
  const priceChangedProductIds: string[] = [];

  for (const id of allIds) {
    const live = liveById.get(id);
    const draft = draftProducts.get(id);
    if (!live || !draft || !productsEqual(live, draft)) changedProductIds.push(id);
    if (draft && (!live || live.priceMinor !== draft.priceMinor)) priceChangedProductIds.push(id);
  }

  const basePublishVersion = readVersion(row.base_publish_version);
  return {
    draftId: row.id,
    shopId: row.shop_id,
    basePublishVersion,
    currentPublishVersion,
    draftRevision: readVersion(row.draft_revision),
    stale: basePublishVersion !== currentPublishVersion,
    changedProductIds,
    priceChangedProductIds,
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

function pathTouchesPricing(path: string): boolean {
  return path
    .replaceAll('[', '.')
    .replaceAll(']', '.')
    .replaceAll('/', '.')
    .split('.')
    .some((segment) => segment === 'priceMinor' || segment === 'price_minor');
}

function changeTouchesPricing(input: CatalogSaveDraftInput): boolean {
  return input.changes.some((change) => {
    if (change.changedPaths !== undefined) {
      return change.changedPaths.some(pathTouchesPricing);
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

function staleVersion(currentVersion: number) {
  return {
    ok: false as const,
    code: 'stale_version' as const,
    message: 'Catalog changed since this version was loaded. Refresh before continuing.',
    currentVersion,
  };
}

function requireCairoLocalTimestamp(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/.test(value)) {
    throw new CatalogServiceError('invalid_scheduled_time');
  }
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

    async loadCatalogPublishing(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogPublishingWorkspace> {
      requirePermission(principal, 'catalog.view', shopId);
      return store.loadPublishing(shopId, principal.businessId);
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
      if (!result.ok) return staleVersion(result.currentVersion);
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

    async restoreCatalogVersion(
      input: CatalogRestoreVersionInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogRestoreVersionResult> {
      requirePermission(principal, 'catalog.publish', input.shopId);
      const currentVersion = await store.getCurrentPublishVersion(input.shopId);
      if (currentVersion !== input.expectedVersion) return staleVersion(currentVersion);

      const result = await store.restoreVersion({
        employeeId: principal.employeeId,
        shopId: input.shopId,
        sourcePublishVersion: input.sourcePublishVersion,
        expectedVersion: input.expectedVersion,
      });
      if (!result.ok && result.code === 'stale_version') {
        return staleVersion(result.currentVersion);
      }
      return result;
    },

    async scheduleCatalogDraft(
      input: CatalogScheduleDraftInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogScheduleResult> {
      requirePermission(principal, 'catalog.publish', input.shopId);
      requireCairoLocalTimestamp(input.localScheduledAt);
      const currentVersion = await store.getCurrentPublishVersion(input.shopId);
      if (currentVersion !== input.expectedVersion) return staleVersion(currentVersion);

      const result = await store.scheduleDraft({
        employeeId: principal.employeeId,
        draftId: input.draftId,
        expectedDraftRevision: input.expectedDraftRevision,
        expectedVersion: input.expectedVersion,
        localScheduledAt: input.localScheduledAt,
      });
      if (!result.ok && result.code === 'stale_version') {
        return staleVersion(result.currentVersion);
      }
      return result;
    },

    async cancelScheduledCatalogChange(
      input: CatalogCancelScheduleInput,
      principal: AdminSessionPrincipal,
    ): Promise<CatalogCancelScheduleResult> {
      requirePermission(principal, 'catalog.publish', input.shopId);
      return store.cancelSchedule({
        employeeId: principal.employeeId,
        shopId: input.shopId,
        scheduleId: input.scheduleId,
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
      const [currentPublishVersion, categories, products, drafts] = await Promise.all([
        loadCurrentPublishVersion(client, shopId),
        client.select<CategoryRow[]>(
          'menu_categories',
          new URLSearchParams({
            select: 'id,shop_id,slug,name,description,sort_order,active',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
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
        categories: categories.map(mapCategory),
        products: products.map(mapProduct),
        drafts: drafts.map(mapDraft),
      };
    },

    async loadPublishing(shopId, businessId) {
      const [currentPublishVersion, versions, schedules, drafts, productRows] = await Promise.all([
        loadCurrentPublishVersion(client, shopId),
        client.select<PublishVersionRow[]>(
          'catalog_publish_versions',
          new URLSearchParams({
            select:
              'shop_id,publish_version,operations_configuration_version,source_kind,draft_id,published_by_employee_id,restored_from_publish_version,published_at',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            order: 'publish_version.desc',
            limit: '100',
          }),
        ),
        client.select<ScheduledChangeRow[]>(
          'scheduled_config_changes',
          new URLSearchParams({
            select:
              'id,shop_id,payload_json,status,timezone,local_scheduled_at,scheduled_for,target_base_publish_version,attempt_count,last_error',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            change_kind: 'eq.CATALOG_PUBLISH',
            order: 'scheduled_for.desc',
            limit: '100',
          }),
        ),
        client.select<PublishingDraftRow[]>(
          'catalog_drafts',
          new URLSearchParams({
            select: 'id,shop_id,base_publish_version,draft_revision,working_bundle_json',
            business_id: `eq.${businessId}`,
            shop_id: `eq.${shopId}`,
            status: 'eq.DRAFT',
            order: 'updated_at.desc',
            limit: '50',
          }),
        ),
        client.select<ProductRow[]>(
          'products',
          new URLSearchParams({
            select:
              'id,shop_id,category_id,slug,name,description,price_minor,image_key,family,best_seller,active,sold_out,is_combo,sort_order',
            shop_id: `eq.${shopId}`,
            order: 'sort_order.asc,id.asc',
          }),
        ),
      ]);

      const liveProducts = productRows.map(mapProduct);
      return {
        shopId,
        currentPublishVersion,
        versions: versions.map(mapPublishVersion),
        draftPreviews: drafts.map((draft) =>
          buildPublishPreview(draft, currentPublishVersion, liveProducts),
        ),
        schedules: schedules.map(mapScheduledChange),
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

    async restoreVersion(input) {
      const result = await client.rpc<unknown>('restore_catalog_publish_version_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_source_publish_version: input.sourcePublishVersion,
        p_expected_current_publish_version: input.expectedVersion,
      });
      return requireRpcResult<StoreRestoreResult>(result);
    },

    async scheduleDraft(input) {
      const result = await client.rpc<unknown>('schedule_catalog_draft_v1', {
        p_employee_id: input.employeeId,
        p_draft_id: input.draftId,
        p_expected_draft_revision: input.expectedDraftRevision,
        p_expected_base_publish_version: input.expectedVersion,
        p_local_scheduled_at: input.localScheduledAt,
      });
      return requireRpcResult<StoreScheduleResult>(result);
    },

    async cancelSchedule(input) {
      const result = await client.rpc<unknown>('cancel_scheduled_config_change_v1', {
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_schedule_id: input.scheduleId,
      });
      return requireRpcResult<CatalogCancelScheduleResult>(result);
    },
  };
}
