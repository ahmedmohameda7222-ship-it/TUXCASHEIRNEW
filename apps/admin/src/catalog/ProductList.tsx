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
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const activeCategories = categories.filter((category) => category.active);
  const categoryCounts = new Map(
    activeCategories.map((category) => [
      category.id,
      products.filter((product) => product.categoryId === category.id).length,
    ]),
  );

  return (
    <section className="admin-catalog-list" aria-label="Products" data-catalog-list>
      <nav className="admin-catalog-category-tabs" aria-label="Product categories">
        <button
          type="button"
          className={!categoryId ? 'is-active' : ''}
          aria-pressed={!categoryId}
          onClick={() => onCategoryChange('')}
        >
          All products <span>{products.length}</span>
        </button>
        {activeCategories.map((category) => (
          <button
            type="button"
            key={category.id}
            className={categoryId === category.id ? 'is-active' : ''}
            aria-pressed={categoryId === category.id}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.name} <span>{categoryCounts.get(category.id) ?? 0}</span>
          </button>
        ))}
      </nav>
      <div className="admin-catalog-list__filters">
        <label className="admin-search-field">
          <span className="sr-only">Search products</span>
          <input
            type="search"
            value={search}
            placeholder="Search products by name…"
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
        <button
          className="admin-secondary-button admin-catalog-reset"
          type="button"
          onClick={() => {
            onSearchChange('');
            onStatusChange('all');
            onCategoryChange('');
          }}
        >
          Reset
        </button>
      </div>

      <div className="admin-catalog-list__summary" aria-live="polite">
        <strong>{visibleProducts.length}</strong>
        <span>{visibleProducts.length === 1 ? 'product' : 'products'}</span>
      </div>

      <div className="admin-catalog-list__columns" aria-hidden="true" data-catalog-product-columns>
        <span>Product</span>
        <span>Category</span>
        <span>Price</span>
        <span>Availability</span>
        <span />
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
              <span className="admin-product-row__monogram" aria-hidden="true">
                {product.name.trim().slice(0, 2).toLocaleUpperCase()}
              </span>
              <span className="admin-product-row__identity">
                <strong>{product.name}</strong>
                <small>
                  Product · {categoryNames.get(product.categoryId) ?? 'Uncategorized'}
                  <span className="admin-product-row__mobile-price">
                    {' · '}EGP {formatEgpMinor(product.priceMinor)}
                  </span>
                </small>
              </span>
            </span>
            <span className="admin-product-row__category">
              {categoryNames.get(product.categoryId) ?? 'Uncategorized'}
            </span>
            <span className="admin-product-row__price">
              EGP {formatEgpMinor(product.priceMinor)}
            </span>
            <span className="admin-product-row__availability">
              <AvailabilityStatus active={product.active} soldOut={product.soldOut} />
            </span>
            <span className="admin-product-row__open" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
        {visibleProducts.length === 0 ? (
          <div className="admin-empty-state">
            <strong>No products match these filters.</strong>
            <span>Change the search or filters to see more products.</span>
            {search || status !== 'all' || categoryId ? (
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => {
                  onSearchChange('');
                  onStatusChange('all');
                  onCategoryChange('');
                }}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
