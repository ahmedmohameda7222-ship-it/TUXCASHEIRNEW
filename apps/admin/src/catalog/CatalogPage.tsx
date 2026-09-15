import type { CatalogProductDetail } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import './catalog.css';
import { createCatalogProductSlug } from './catalogProductSlug';
import { ProductInspector } from './ProductInspector';
import { ProductList, type CatalogStatusFilter } from './ProductList';
import { CatalogUiError, useCatalog } from './useCatalog';

function permission(principal: { permissions: readonly string[] }, key: string): boolean {
  return principal.permissions.includes(key);
}

function mutationMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof CatalogUiError) {
    if (error.code === 'stale_version') {
      return `The live catalog changed${error.currentVersion === undefined ? '' : ` to version ${error.currentVersion}`}. Refresh before continuing.`;
    }
    if (error.code === 'stale_draft_revision') {
      return 'This draft changed in another session. Refresh before editing again.';
    }
    if (error.code === 'draft_selection_required') {
      return 'More than one compatible saved draft exists. Select the draft you want to resume before editing.';
    }
    if (error.code === 'permission_forbidden') return 'Your role cannot make this catalog change.';
    return `Catalog action failed: ${error.code}.`;
  }
  return 'Catalog action failed. Refresh and try again.';
}

function newProductForShop(
  shopId: string,
  categoryId: string,
  products: readonly CatalogProductDetail[],
): CatalogProductDetail {
  const maxSortOrder = products.reduce((max, product) => Math.max(max, product.sortOrder), 0);
  const id = crypto.randomUUID();
  return {
    id,
    shopId,
    categoryId,
    slug: createCatalogProductSlug(id),
    name: 'New product',
    description: null,
    priceMinor: 0,
    imageKey: null,
    family: null,
    bestSeller: false,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: maxSortOrder + 10,
  };
}

export function CatalogPage() {
  const { principal, scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const catalog = useCatalog(shopId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CatalogStatusFilter>('all');
  const [categoryId, setCategoryId] = useState('');
  const [newProductCategoryId, setNewProductCategoryId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [unsavedProduct, setUnsavedProduct] = useState<CatalogProductDetail | null>(null);

  const canEdit = permission(principal, 'catalog.edit');
  const canPrice = permission(principal, 'catalog.pricing');
  const categories = catalog.workspaceQuery.data?.categories ?? [];
  const activeCategories = categories.filter((category) => category.active);
  const firstActiveCategory = activeCategories[0];

  useEffect(() => {
    if (activeCategories.some((category) => category.id === newProductCategoryId)) return;
    setNewProductCategoryId(firstActiveCategory?.id ?? '');
  }, [activeCategories, firstActiveCategory?.id, newProductCategoryId]);

  const selectedProduct = useMemo(() => {
    if (unsavedProduct) return unsavedProduct;
    if (selectedProductId) {
      const selected = catalog.products.find((product) => product.id === selectedProductId);
      if (selected) return selected;
    }
    return catalog.products[0] ?? null;
  }, [catalog.products, selectedProductId, unsavedProduct]);

  const actionError = mutationMessage(
    catalog.resumeDraft.error ??
      catalog.prepareProductDraft.error ??
      catalog.saveProduct.error ??
      catalog.setAvailability.error,
  );
  const busy =
    catalog.resumeDraft.isPending ||
    catalog.prepareProductDraft.isPending ||
    catalog.saveProduct.isPending ||
    catalog.setAvailability.isPending;

  function openProduct(productId: string) {
    setUnsavedProduct(null);
    setSelectedProductId(productId);
    setMobileEditing(true);
  }

  function handleCategoryFilterChange(nextCategoryId: string) {
    setCategoryId(nextCategoryId);
    if (activeCategories.some((category) => category.id === nextCategoryId)) {
      setNewProductCategoryId(nextCategoryId);
    }
  }

  function startNewProduct() {
    if (!shopId || !newProductCategoryId || !canEdit || !canPrice) return;
    const product = newProductForShop(shopId, newProductCategoryId, catalog.products);
    setUnsavedProduct(product);
    setSelectedProductId(product.id);
    setMobileEditing(true);
  }

  function closeEditor() {
    if (unsavedProduct) {
      setUnsavedProduct(null);
      setSelectedProductId(null);
    }
    setMobileEditing(false);
  }

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Catalog control"
        title="Catalog"
        description="Catalog mutations are always scoped to one concrete shop."
      >
        <div className="admin-callout" role="status">
          <strong>Select a shop to manage its catalog.</strong>
          <span>All Shops is read-only for shop-scoped catalog changes.</span>
        </div>
      </PageScaffold>
    );
  }

  if (catalog.workspaceQuery.isLoading) {
    return (
      <PageScaffold eyebrow="Catalog control" title="Catalog" description="Loading live catalog…">
        <div className="admin-catalog-loading" aria-busy="true">Loading products…</div>
      </PageScaffold>
    );
  }

  if (catalog.workspaceQuery.isError || !catalog.workspaceQuery.data) {
    return (
      <PageScaffold
        eyebrow="Catalog control"
        title="Catalog"
        description="The live catalog could not be loaded."
        primaryAction={
          <button className="admin-primary-button" type="button" onClick={() => void catalog.workspaceQuery.refetch()}>
            Retry
          </button>
        }
      >
        <div className="admin-callout is-danger" role="alert">
          <strong>Catalog unavailable.</strong>
          <span>No changes were made.</span>
        </div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      eyebrow="Catalog control"
      title="Catalog"
      description={`Live version ${catalog.workspaceQuery.data.currentPublishVersion}. Normal edits stay in a draft until published.`}
      primaryAction={
        <div className="admin-catalog-new-product-controls">
          <label>
            <span>New product category</span>
            <select
              aria-label="New product category"
              value={newProductCategoryId}
              disabled={!canEdit || !canPrice || activeCategories.length === 0 || busy}
              onChange={(event) => setNewProductCategoryId(event.target.value)}
            >
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <button
            className="admin-primary-button"
            type="button"
            disabled={!canEdit || !canPrice || !newProductCategoryId || busy}
            title={!canPrice ? 'Creating a product requires catalog.pricing access.' : undefined}
            onClick={startNewProduct}
          >
            New product
          </button>
        </div>
      }
    >
      {!catalog.activeDraft && catalog.compatibleDrafts.length > 0 ? (
        <div className="admin-callout" role="status">
          <strong>Saved draft work is available.</strong>
          <span>
            {catalog.compatibleDrafts.length === 1
              ? 'Your compatible saved draft will resume automatically when you edit.'
              : 'Multiple compatible drafts exist. Select one explicitly so no saved work is silently replaced.'}
          </span>
          {catalog.compatibleDrafts.length > 1 ? (
            <div className="admin-settings-row__main">
              {catalog.compatibleDrafts.map((draft) => (
                <button
                  key={draft.id}
                  className="admin-secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void catalog.resumeDraft.mutateAsync(draft.id)}
                >
                  Resume {draft.title ?? `draft ${draft.id.slice(0, 8)}`} · rev {draft.draftRevision}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {catalog.activeDraft ? (
        <div className="admin-catalog-draft-banner" role="status">
          <div>
            <strong>Draft in progress</strong>
            <span>Base v{catalog.activeDraft.basePublishVersion} · revision {catalog.activeDraft.draftRevision}</span>
          </div>
          <span className="admin-status-pill">Not live</span>
        </div>
      ) : null}

      {catalog.draftInvalidatedByLiveChange ? (
        <div className="admin-callout is-warning" role="status">
          <strong>Live availability changed.</strong>
          <span>The previous unscheduled editing session was cleared. Persisted compatible work remains available for explicit resume.</span>
        </div>
      ) : null}

      {actionError ? (
        <div className="admin-callout is-danger" role="alert">
          <strong>Change not saved.</strong>
          <span>{actionError}</span>
        </div>
      ) : null}

      <div className={mobileEditing ? 'admin-catalog-layout is-editing' : 'admin-catalog-layout'}>
        <div className="admin-catalog-layout__list">
          <ProductList
            products={catalog.products}
            categories={categories}
            selectedProductId={selectedProduct?.id ?? null}
            search={search}
            status={status}
            categoryId={categoryId}
            onSearchChange={setSearch}
            onStatusChange={setStatus}
            onCategoryChange={handleCategoryFilterChange}
            onSelectProduct={openProduct}
          />
        </div>

        <div className="admin-catalog-layout__editor">
          {selectedProduct ? (
            <ProductInspector
              product={selectedProduct}
              canEdit={canEdit}
              canPrice={canPrice}
              busy={busy}
              draftRevision={catalog.activeDraft?.draftRevision ?? null}
              advancedBundle={catalog.activeDraft?.bundleJson ?? null}
              onClose={closeEditor}
              onRequestAdvanced={async () => { await catalog.prepareProductDraft.mutateAsync(selectedProduct); }}
              onSaveDraft={async (draft) => {
                await catalog.saveProduct.mutateAsync(draft);
                setUnsavedProduct(null);
                setSelectedProductId(draft.product.id);
              }}
              onSetAvailability={async (soldOut) => {
                await catalog.setAvailability.mutateAsync({ productId: selectedProduct.id, soldOut });
              }}
            />
          ) : (
            <div className="admin-catalog-empty-inspector">
              <strong>No product selected.</strong>
              <span>Select a product from the list to inspect or edit it.</span>
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}