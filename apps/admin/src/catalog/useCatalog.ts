import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CatalogCancelScheduleResult,
  CatalogDraftCreateResult,
  CatalogDraftSaveResult,
  CatalogImmediateAvailabilityResult,
  CatalogJsonObject,
  CatalogJsonValue,
  CatalogProductDetail,
  CatalogPublishingWorkspace,
  CatalogPublishResult,
  CatalogRestoreVersionResult,
  CatalogScheduleResult,
  CatalogWorkspace,
} from '@tux/admin-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import type { ProductEditorDraft } from './ProductEditor';

export type ActiveCatalogDraft = {
  draftId: string;
  draftRevision: number;
  basePublishVersion: number;
  bundleJson: CatalogJsonObject;
};

export class CatalogUiError extends Error {
  constructor(
    readonly code: string,
    readonly currentVersion?: number,
  ) {
    super(code);
    this.name = 'CatalogUiError';
  }
}

function catalogQueryKey(shopId: string) {
  return ['admin', 'catalog', shopId] as const;
}

function catalogPublishingQueryKey(shopId: string) {
  return ['admin', 'catalog', shopId, 'publishing'] as const;
}

function isJsonObject(value: CatalogJsonValue | undefined): value is CatalogJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function productJson(product: CatalogProductDetail): CatalogJsonObject {
  return {
    id: product.id,
    shopId: product.shopId,
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

export function upsertProductInBundle(
  bundleJson: CatalogJsonObject,
  product: CatalogProductDetail,
): CatalogJsonObject {
  const snapshot = bundleJson['snapshot'];
  if (!isJsonObject(snapshot)) throw new CatalogUiError('catalog_bundle_invalid');
  const products = snapshot['products'];
  if (!Array.isArray(products)) throw new CatalogUiError('catalog_bundle_invalid');

  let replaced = false;
  const nextProducts = products.map((candidate) => {
    if (isJsonObject(candidate) && candidate['id'] === product.id) {
      replaced = true;
      return productJson(product);
    }
    return candidate;
  });
  if (!replaced) nextProducts.push(productJson(product));

  return {
    ...bundleJson,
    snapshot: {
      ...snapshot,
      products: nextProducts,
    },
  };
}

function csrfTokenForMutation(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new CatalogUiError('session_required');
  return session.state.session.csrfToken;
}

function currentWorkspace(queryClient: QueryClient, shopId: string): CatalogWorkspace | undefined {
  return queryClient.getQueryData<CatalogWorkspace>(catalogQueryKey(shopId));
}

async function invalidateCatalogState(queryClient: QueryClient, shopId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: catalogQueryKey(shopId) }),
    queryClient.invalidateQueries({ queryKey: catalogPublishingQueryKey(shopId) }),
  ]);
}

export function useCatalog(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [activeDraft, setActiveDraft] = useState<ActiveCatalogDraft | null>(null);
  const activeDraftRef = useRef<ActiveCatalogDraft | null>(null);
  const [draftProducts, setDraftProducts] = useState<Record<string, CatalogProductDetail>>({});
  const [draftInvalidatedByLiveChange, setDraftInvalidatedByLiveChange] = useState(false);

  useEffect(() => {
    activeDraftRef.current = null;
    setActiveDraft(null);
    setDraftProducts({});
    setDraftInvalidatedByLiveChange(false);
  }, [shopId]);

  const workspaceQuery = useQuery({
    queryKey: shopId ? catalogQueryKey(shopId) : ['admin', 'catalog', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      return adminFetch<CatalogWorkspace>(
        `/api/admin/catalog?shopId=${encodeURIComponent(shopId)}`,
      );
    },
  });

  const products = useMemo(() => {
    const merged = new Map<string, CatalogProductDetail>();
    for (const product of workspaceQuery.data?.products ?? []) merged.set(product.id, product);
    for (const product of Object.values(draftProducts)) merged.set(product.id, product);
    return [...merged.values()].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
  }, [draftProducts, workspaceQuery.data?.products]);

  const saveProduct = useMutation({
    mutationFn: async ({ product, changedPaths }: ProductEditorDraft) => {
      if (!shopId || product.shopId !== shopId) throw new CatalogUiError('concrete_shop_required');
      const workspace = currentWorkspace(queryClient, shopId) ?? workspaceQuery.data;
      if (!workspace) throw new CatalogUiError('catalog_not_loaded');
      const csrfToken = csrfTokenForMutation(session);

      let draft = activeDraftRef.current;
      if (!draft || draft.basePublishVersion !== workspace.currentPublishVersion) {
        const created = await adminFetch<CatalogDraftCreateResult>(
          '/api/admin/catalog',
          {
            method: 'POST',
            body: JSON.stringify({
              type: 'draft.create',
              shopId,
              expectedVersion: workspace.currentPublishVersion,
              title: `Catalog edits · ${product.name}`,
            }),
          },
          csrfToken,
        );
        if (!created.ok) throw new CatalogUiError(created.code, created.currentVersion);
        draft = {
          draftId: created.draftId,
          draftRevision: created.draftRevision,
          basePublishVersion: created.basePublishVersion,
          bundleJson: created.bundleJson,
        };
      }

      const bundleJson = upsertProductInBundle(draft.bundleJson, product);
      const saved = await adminFetch<CatalogDraftSaveResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'draft.save',
            draftId: draft.draftId,
            shopId,
            expectedDraftRevision: draft.draftRevision,
            changes: [{ kind: 'bundle.replace', bundleJson, changedPaths }],
          }),
        },
        csrfToken,
      );
      if (!saved.ok) throw new CatalogUiError(saved.code);

      const nextDraft: ActiveCatalogDraft = {
        draftId: draft.draftId,
        draftRevision: saved.draftRevision,
        basePublishVersion: saved.basePublishVersion,
        bundleJson,
      };
      activeDraftRef.current = nextDraft;
      return { draft: nextDraft, product };
    },
    onSuccess({ draft, product }) {
      setActiveDraft(draft);
      setDraftProducts((current) => ({ ...current, [product.id]: product }));
      setDraftInvalidatedByLiveChange(false);
    },
  });

  const setAvailability = useMutation({
    mutationFn: async ({ productId, soldOut }: { productId: string; soldOut: boolean }) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogImmediateAvailabilityResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'availability.set', shopId, productId, soldOut }),
        },
        csrfTokenForMutation(session),
      );
      if (!result.ok) throw new CatalogUiError(result.code);
      return result;
    },
    async onSuccess() {
      const hadDraft = activeDraftRef.current !== null;
      activeDraftRef.current = null;
      setActiveDraft(null);
      setDraftProducts({});
      setDraftInvalidatedByLiveChange(hadDraft);
      if (shopId) await invalidateCatalogState(queryClient, shopId);
    },
  });

  return {
    workspaceQuery,
    products,
    activeDraft,
    draftInvalidatedByLiveChange,
    saveProduct,
    setAvailability,
  };
}

export function useCatalogPublishing(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const publishingQuery = useQuery({
    queryKey: shopId
      ? catalogPublishingQueryKey(shopId)
      : ['admin', 'catalog', 'no-shop', 'publishing'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      return adminFetch<CatalogPublishingWorkspace>(
        `/api/admin/catalog?shopId=${encodeURIComponent(shopId)}&view=publishing`,
      );
    },
  });

  const publishDraft = useMutation({
    mutationFn: async (input: {
      draftId: string;
      expectedDraftRevision: number;
      expectedVersion: number;
    }) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogPublishResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'draft.publish', shopId, ...input }),
        },
        csrfTokenForMutation(session),
      );
      if (!result.ok) {
        throw new CatalogUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
      }
      return result;
    },
    async onSuccess() {
      if (shopId) await invalidateCatalogState(queryClient, shopId);
    },
  });

  const scheduleDraft = useMutation({
    mutationFn: async (input: {
      draftId: string;
      expectedDraftRevision: number;
      expectedVersion: number;
      localScheduledAt: string;
    }) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogScheduleResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'draft.schedule', shopId, ...input }),
        },
        csrfTokenForMutation(session),
      );
      if (!result.ok) {
        throw new CatalogUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
      }
      return result;
    },
    async onSuccess() {
      if (shopId) await invalidateCatalogState(queryClient, shopId);
    },
  });

  const restoreVersion = useMutation({
    mutationFn: async (input: { sourcePublishVersion: number; expectedVersion: number }) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogRestoreVersionResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'version.restore', shopId, ...input }),
        },
        csrfTokenForMutation(session),
      );
      if (!result.ok) {
        throw new CatalogUiError(result.code, 'currentVersion' in result ? result.currentVersion : undefined);
      }
      return result;
    },
    async onSuccess() {
      if (shopId) await invalidateCatalogState(queryClient, shopId);
    },
  });

  const cancelSchedule = useMutation({
    mutationFn: async (scheduleId: string) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogCancelScheduleResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({ type: 'schedule.cancel', shopId, scheduleId }),
        },
        csrfTokenForMutation(session),
      );
      if (!result.ok) throw new CatalogUiError(result.code);
      return result;
    },
    async onSuccess() {
      if (shopId) await invalidateCatalogState(queryClient, shopId);
    },
  });

  return { publishingQuery, publishDraft, scheduleDraft, restoreVersion, cancelSchedule };
}
