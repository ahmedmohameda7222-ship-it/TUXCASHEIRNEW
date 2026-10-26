import type { CatalogCategorySummary, CatalogProductDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductList, filterCatalogProducts } from './ProductList';

const product = {
  id: 'p1',
  shopId: 'shop-1',
  categoryId: 'cat-1',
  slug: 'burger',
  name: 'Double smash burger',
  description: null,
  priceMinor: 12900,
  imageKey: null,
  family: null,
  bestSeller: false,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
} as CatalogProductDetail;
const category = { id: 'cat-1', name: 'Burgers', active: true } as CatalogCategorySummary;

describe('P02 catalog browse regression', () => {
  it('renders distinct product identity, category, price and live availability', () => {
    const html = renderToStaticMarkup(
      <ProductList
        products={[product]}
        categories={[category]}
        selectedProductId={null}
        search=""
        status="all"
        categoryId=""
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onSelectProduct={vi.fn()}
      />,
    );
    expect(html).toContain('Double smash burger');
    expect(html).toContain('Burgers');
    expect(html).toContain('EGP 129.00');
    expect(html).toContain('Available');
  });
  it('combines category and sold-out filters without leaking archived products', () => {
    const soldOut = { ...product, id: 'p2', soldOut: true };
    const archived = { ...soldOut, id: 'p3', active: false };
    expect(
      filterCatalogProducts([product, soldOut, archived], '', 'sold-out', 'cat-1').map((p) => p.id),
    ).toEqual(['p2']);
  });
  it('offers a keyboard-reachable filter reset on an empty filtered browse view', () => {
    const html = renderToStaticMarkup(
      <ProductList
        products={[product]}
        categories={[category]}
        selectedProductId={null}
        search="none"
        status="all"
        categoryId=""
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onSelectProduct={vi.fn()}
      />,
    );
    expect(html).toContain('Clear filters');
    expect(html).toContain('No products match');
  });

  it('matches the approved C1 browse contract with category shortcuts and factual column headings', () => {
    const html = renderToStaticMarkup(
      <ProductList
        products={[product, { ...product, id: 'p2', name: 'Second Burger', soldOut: true }]}
        categories={[category]}
        selectedProductId={null}
        search=""
        status="all"
        categoryId=""
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onSelectProduct={vi.fn()}
      />,
    );
    expect(html).toContain('aria-label="Product categories"');
    expect(html).toContain('All products');
    expect(html).toContain('data-catalog-product-columns');
    expect(html).toContain('Product');
    expect(html).toContain('Category');
    expect(html).toContain('Price');
    expect(html).toContain('Availability');
    expect(html).toContain('<strong>2</strong><span>products</span>');
  });

  it('C1 search includes the authorized category label without matching product name or slug', () => {
    const dailySpecial = {
      ...product,
      name: 'Daily Special',
      slug: 'daily-special',
      description: null,
    };
    expect(filterCatalogProducts([dailySpecial], 'burgers', 'all', '', [category])).toEqual([
      dailySpecial,
    ]);
  });

  it('C1 mobile filter controls declare an accessible collapsed Filters disclosure', () => {
    const html = renderToStaticMarkup(
      <ProductList
        products={[product]}
        categories={[category]}
        selectedProductId={null}
        search=""
        status="all"
        categoryId=""
        onSearchChange={vi.fn()}
        onStatusChange={vi.fn()}
        onCategoryChange={vi.fn()}
        onSelectProduct={vi.fn()}
      />,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Filters');
  });
});
