import type { CatalogCategorySummary, CatalogProductDetail } from '@tux/admin-contracts';

import { AvailabilityStatus } from './AvailabilityStatus';
import { formatEgpMinor } from './ProductEditor';

export type CatalogStatusFilter = 'all' | 'available' | 'sold-out' | 'archived';

export function filterCatalogProducts(
  products: readonly CatalogProductDetail[],
  search: string,
  status: CatalogStatusFilter,
  categoryId: string,
): CatalogProductDetail[] {
  const query = search.trim().toLocaleLowerCase();
  return products.filter((product) => {
    if (categoryId && product.categoryId !== categoryId) return false;
    if (status === 'available' && (!product.active || product.soldOut)) return false;
    if (status === 'sold-out' && (!product.active || !product.soldOut)) return false;
    if (status === 'archived' && product.active) return false;
    if (!query) return true;
    return [product.name, product.slug ?? '', product.description ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}

export function ProductList({
  products,
  categories,
  selectedProductId,
  search,
  status,
  categoryId,
  onSearchChange,
  onStatusChange,
  onCategoryChange,
  onSelectProduct,
}: {
  products: readonly CatalogProductDetail[];
  categories: readonly CatalogCategorySummary[];
  selectedProductId: string | null;
  search: string;
  status: CatalogStatusFilter;
  categoryId: string;
  onSearchChange(value: string): void;
  onStatusChange(value: CatalogStatusFilter): void;
  onCategoryChange(value: string): void;
  onSelectProduct(productId: string): void;
}) {
  const visibleProducts = filterCatalogProducts(products, search, status, categoryId);

  return (
    <section className="admin-catalog-list" aria-label="Products" data-catalog-list>
      <div className="admin-catalog-list__filters">
        <label className="admin-search-field">
          <span className="sr-only">Search products</span>
          <input
            type="search"
            value={search}
            placeholder="Search products"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </label>
        <div className="admin-catalog-list__filter-row">
          <label className="admin-select-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => onStatusChange(event.currentTarget.value as CatalogStatusFilter)}
            >
              <option value="all">All status</option>
              <option value="available">Available</option>
              <option value="sold-out">Sold out</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="admin-select-field">
            <span>Category</span>
            <select
              value={categoryId}
              onChange={(event) => onCategoryChange(event.currentTarget.value)}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="admin-catalog-list__summary" aria-live="polite">
        <strong>{visibleProducts.length}</strong>
        <span>{visibleProducts.length === 1 ? 'product' : 'products'}</span>
      </div>

      <div className="admin-catalog-list__items">
        {visibleProducts.map((product) => (
          <button
            className={
              product.id === selectedProductId
                ? 'admin-product-row is-selected'
                : 'admin-product-row'
            }
            type="button"
            key={product.id}
            aria-pressed={product.id === selectedProductId}
            onClick={() => onSelectProduct(product.id)}
          >
            <span className="admin-product-row__main">
              <strong>{product.name}</strong>
              <span>EGP {formatEgpMinor(product.priceMinor)}</span>
            </span>
            <AvailabilityStatus active={product.active} soldOut={product.soldOut} />
          </button>
        ))}
        {visibleProducts.length === 0 ? (
          <div className="admin-empty-state">
            <strong>No products match these filters.</strong>
            <span>Change the search or filters to see more products.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
