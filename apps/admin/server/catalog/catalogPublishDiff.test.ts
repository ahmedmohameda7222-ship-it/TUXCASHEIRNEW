import type { CatalogProductDetail } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { buildCatalogPublishDiffs, CatalogPublishDiffError } from './catalogPublishDiff';

const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const product: CatalogProductDetail = {
  id: 'product-1',
  shopId: shop,
  categoryId: 'category-1',
  slug: 'burger',
  name: 'Burger',
  description: null,
  priceMinor: 1000,
  imageKey: null,
  family: null,
  bestSeller: false,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
};

describe('publishing field-level Before → After review', () => {
  it('shows renamed product and price changes while retaining unchanged categories', () => {
    const draft = {
      snapshot: {
        products: [{ ...product, name: 'Burger Deluxe', priceMinor: 1400 }],
        categories: [{ id: 'category-1', shopId: shop, name: 'Burgers', active: true, sortOrder: 10 }],
        modifiers: [],
      },
    };
    const published = {
      snapshot: {
        categories: [{ id: 'category-1', shopId: shop, name: 'Burgers', active: true, sortOrder: 10 }],
        modifiers: [],
      },
    };
    const changes = buildCatalogPublishDiffs(shop, [product], draft, published);
    const renamed = changes.find((change) => change.kind === 'product');
    expect(renamed?.status).toBe('modified');
    expect(renamed?.changedFields).toEqual(['name', 'priceMinor']);
    expect(renamed?.before?.name).toBe('Burger');
    expect(renamed?.after?.priceMinor).toBe(1400);
    expect(changes.find((change) => change.kind === 'category')?.status).toBe('unchanged');
  });

  it('describes category creation, modifier removal, and image/visibility changes', () => {
    const changes = buildCatalogPublishDiffs(
      shop,
      [product],
      {
        snapshot: {
          products: [{ ...product, imageKey: 'shop/photo.webp', active: false }],
          categories: [{ id: 'category-2', shopId: shop, name: 'New', active: true }],
          modifiers: [],
        },
      },
      {
        snapshot: {
          categories: [],
          modifiers: [{ id: 'modifier-1', shopId: shop, name: 'Cheese', priceMinor: 200 }],
        },
      },
    );
    expect(changes.find((change) => change.kind === 'product')?.changedFields).toEqual([
      'imageKey',
      'active',
    ]);
    expect(changes.find((change) => change.kind === 'category')?.status).toBe('added');
    expect(changes.find((change) => change.kind === 'modifier')?.status).toBe('removed');
  });

  it('fails closed on a cross-shop entity instead of leaking its details', () => {
    expect(() =>
      buildCatalogPublishDiffs(shop, [], {
        snapshot: { products: [{ ...product, shopId: other }], categories: [], modifiers: [] },
      }, { snapshot: { categories: [], modifiers: [] } }),
    ).toThrow(CatalogPublishDiffError);
  });
});
