import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';

import { CatalogFirstRunGuide } from './CatalogFirstRunGuide';

describe('catalog first-run readiness', () => {
  it('gives an empty shop a concrete category-first and cross-shop copy path', () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <CatalogFirstRunGuide
          hasCategories={false}
          productCount={0}
          canEdit
          hasCopySources
          onManageCategories={vi.fn()}
          onCreateProduct={vi.fn()}
        />
      </Router>,
    );
    expect(html).toContain('Set up this shop');
    expect(html).toContain('Add your first category');
    expect(html).toContain('Copy from an existing shop');
    expect(html).toContain('/catalog/products/publishing');
    expect(html).not.toContain('Create your first product');
  });

  it('offers a first product when a category is already available', () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <CatalogFirstRunGuide
          hasCategories
          productCount={0}
          canEdit
          hasCopySources={false}
          onManageCategories={vi.fn()}
          onCreateProduct={vi.fn()}
        />
      </Router>,
    );
    expect(html).toContain('Create your first product');
    expect(html).not.toContain('Add your first category');
    expect(html).not.toContain('Copy from an existing shop');
  });

  it('does not expose unauthorized setup controls', () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <CatalogFirstRunGuide
          hasCategories={false}
          productCount={0}
          canEdit={false}
          hasCopySources
          onManageCategories={vi.fn()}
          onCreateProduct={vi.fn()}
        />
      </Router>,
    );
    expect(html).not.toContain('Add your first category');
    expect(html).not.toContain('Create your first product');
    expect(html).not.toContain('Copy from an existing shop');
  });
});
