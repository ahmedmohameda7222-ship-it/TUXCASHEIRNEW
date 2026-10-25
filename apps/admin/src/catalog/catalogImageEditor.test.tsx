import type { CatalogProductDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';

import { ProductEditor } from './ProductEditor';

const product: CatalogProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: '22222222-2222-4222-8222-222222222222',
  categoryId: '33333333-3333-4333-8333-333333333333',
  slug: null,
  name: 'Burger',
  description: null,
  priceMinor: 12900,
  imageKey: null,
  family: null,
  bestSeller: false,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
};

describe('Catalog image editor', () => {
  it('offers a real file upload with accessible size/format constraints', () => {
    const markup = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <ProductEditor
          product={product}
          canEdit
          canPrice
          onSaveDraft={vi.fn()}
          onSetAvailability={vi.fn()}
          onUploadImage={vi.fn()}
        />
      </Router>,
    );
    expect(markup).toContain('type="file"');
    expect(markup).toContain('image/png,image/jpeg,image/webp,image/avif');
    expect(markup).toContain('2 MB');
    expect(markup).toContain('Upload image');
    expect(markup).not.toContain('managed outside this screen');
  });

  it('allows an existing image to be removed through the next draft save', () => {
    const markup = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <ProductEditor
          product={{ ...product, imageKey: 'shop/existing.webp' }}
          canEdit
          canPrice
          onSaveDraft={vi.fn()}
          onSetAvailability={vi.fn()}
          onUploadImage={vi.fn()}
        />
      </Router>,
    );
    expect(markup).toContain('Remove image from draft');
    expect(markup).toContain('Image assigned');
  });
  it('disables uploading an entirely unsaved product until its first draft save', () => {
    const markup = renderToStaticMarkup(
      <Router ssrPath="/catalog/products">
        <ProductEditor
          product={product}
          canEdit
          canPrice
          imageRequiresSaveFirst
          onSaveDraft={vi.fn()}
          onSetAvailability={vi.fn()}
          onUploadImage={vi.fn()}
        />
      </Router>,
    );
    expect(markup).toContain('Save this product draft first');
    expect(markup).toMatch(/type="file"[^>]*disabled/);
    expect(markup).toMatch(/disabled[^>]*>Upload image/);
  });

});
