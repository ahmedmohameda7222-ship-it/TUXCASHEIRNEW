import type { CatalogProductDetail } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import './catalog.css';
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
  return {
    id: crypto.randomUUID(),
    shopId,
    categoryId,
    slug: null,
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
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [unsavedProduct, setUnsavedProduct] = useState<CatalogProductDetail | null>(null);

  const canEdit = permission(principal, 'catalog.edit');
  const canPrice = permission(principal, 'catalog.pricing');
  const categories = catalog.workspaceQuery.data?.categories ?? [];
  const firstActiveCategory = categories.find((category) => category.active) ?? categories[0];
  const selectedProduct = useMemo(() => {
    if (unsavedProduct) return unsavedProduct;
    if (selectedProductId) {
      const selected = catalog.products.find((product) => product.id === selectedProductId);
      if (selected) return selected;
    }
    return catalog.products[0] ?? null;
  }, [catalog.products, selectedProductId, unsavedProduct]);

  const actionError = mutationMessage(catalog.saveProduct.error ?? catalog.setAvailability.error);
  const busy = catalog.saveProduct.isPending || catalog.setAvailability.isPending;

  function openProduct(productId: string) {
    setUnsavedProduct(null);
    setSelectedProductId(productId);
    setMobileEditing(true);
  }

  function startNewProduct() {
    if (!shopId || !firstActiveCategory || !canEdit || !canPrice) return;
    const product = newProductForShop(shopId, firstActiveCategory.id, catalog.products);
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
        <div className="admin-catalog-loading" aria-busy="true">
          Loading products…
        </div>
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
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => void catalog.workspaceQuery.refetch()}
          >
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
        <button
          className="admin-primary-button"
          type="button"
          disabled={!canEdit || !canPrice || !firstActiveCategory || busy}
          title={!canPrice ? 'Creating a product requires catalog.pricing access.' : undefined}
          onClick={startNewProduct}
        >
          New product
        </button>
      }
    >
      {catalog.activeDraft ? (
        <div className="admin-catalog-draft-banner" role="status">
          <div>
            <strong>Draft in progress</strong>
            <span>
              Base v{catalog.activeDraft.basePublishVersion} · revision{' '}
              {catalog.activeDraft.draftRevision}
            </span>
          </div>
          <span className="admin-status-pill">Not live</span>
        </div>
      ) : null}

      {catalog.draftInvalidatedByLiveChange ? (
        <div className="admin-callout is-warning" role="status">
          <strong>Live availability changed.</strong>
          <span>
            The previous draft is now stale by design. The next normal edit starts from the newest
            live version.
          </span>
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
            onCategoryChange={setCategoryId}
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
              onClose={closeEditor}
              onSaveDraft={async (draft) => {
                await catalog.saveProduct.mutateAsync(draft);
                setUnsavedProduct(null);
                setSelectedProductId(draft.product.id);
              }}
              onSetAvailability={async (soldOut) => {
                await catalog.setAvailability.mutateAsync({
                  productId: selectedProduct.id,
                  soldOut,
                });
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
