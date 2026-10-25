import type {
  CatalogCategorySummary,
  CatalogJsonObject,
  CatalogProductDetail,
} from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import {
  CatalogBulkEditError,
  previewCatalogBulkEdit,
  stageCatalogBulkEditBundle,
} from './catalogBulkEdit';

const shopA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const shopB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const categoryA = '11111111-1111-4111-8111-111111111111';
const categoryB = '22222222-2222-4222-8222-222222222222';
const product = (id: string, priceMinor: number, shopId = shopA): CatalogProductDetail => ({
  id,
  shopId,
  categoryId: categoryA,
  slug: null,
  name: id,
  description: null,
  priceMinor,
  imageKey: null,
  family: null,
  bestSeller: false,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
});
const a = product('a', 1001);
const b = product('b', 2000);
const foreign = product('foreign', 4000, shopB);
const categories = [
  { id: categoryA, shopId: shopA, active: true },
  { id: categoryB, shopId: shopB, active: true },
] as CatalogCategorySummary[];
const bundle: CatalogJsonObject = {
  snapshot: { products: [a, b, foreign], categories },
};

describe('atomic Catalog bulk draft staging', () => {
  it('previews fixed and percentage prices using integer minor units', () => {
    const fixed = previewCatalogBulkEdit(
      [a, b],
      shopA,
      ['a', 'b'],
      {
        kind: 'price.fixed',
        priceMinor: 1500,
      },
      categories,
    );
    expect(fixed.map((row) => [row.before.priceMinor, row.after.priceMinor])).toEqual([
      [1001, 1500],
      [2000, 1500],
    ]);
    const percent = previewCatalogBulkEdit(
      [a, b],
      shopA,
      ['a', 'b'],
      {
        kind: 'price.percentage',
        percentage: 10,
      },
      categories,
    );
    expect(percent.map((row) => row.after.priceMinor)).toEqual([1101, 2200]);
  });

  it('stages all selected products as one complete bundle replacement', () => {
    const staged = stageCatalogBulkEditBundle(
      bundle,
      shopA,
      ['a', 'b'],
      {
        kind: 'archive',
        archived: true,
      },
      categories,
    );
    const items = (staged.bundleJson.snapshot as CatalogJsonObject).products as CatalogJsonObject[];
    expect(items.filter((item) => item.active === false).map((item) => item.id)).toEqual([
      'a',
      'b',
    ]);
    expect(items.find((item) => item.id === 'foreign')?.active).toBe(true);
    expect(staged.changedPaths).toContain('products');
  });

  it('rejects cross-shop, invalid, and duplicate selections atomically', () => {
    const patch = { kind: 'price.fixed', priceMinor: 500 } as const;
    expect(() =>
      stageCatalogBulkEditBundle(bundle, shopA, ['a', 'foreign'], patch, categories),
    ).toThrow(CatalogBulkEditError);
    expect(() => stageCatalogBulkEditBundle(bundle, shopA, ['a', 'a'], patch, categories)).toThrow(
      CatalogBulkEditError,
    );
    expect(() =>
      stageCatalogBulkEditBundle(bundle, shopA, ['a', 'missing'], patch, categories),
    ).toThrow(CatalogBulkEditError);
    expect(() =>
      stageCatalogBulkEditBundle(
        bundle,
        shopA,
        ['a'],
        { kind: 'price.fixed', priceMinor: -1 },
        categories,
      ),
    ).toThrow(CatalogBulkEditError);
    expect(() =>
      stageCatalogBulkEditBundle(
        bundle,
        shopA,
        ['a'],
        { kind: 'category.assign', categoryId: categoryB },
        categories,
      ),
    ).toThrow(CatalogBulkEditError);
  });

  it('rejects invalid percentage and overflowing adjustment before any mutation', () => {
    expect(() =>
      previewCatalogBulkEdit(
        [a],
        shopA,
        ['a'],
        { kind: 'price.percentage', percentage: -120 },
        categories,
      ),
    ).toThrow(CatalogBulkEditError);
    expect(() =>
      previewCatalogBulkEdit(
        [a],
        shopA,
        ['a'],
        { kind: 'price.adjust', deltaMinor: -1002 },
        categories,
      ),
    ).toThrow(CatalogBulkEditError);
  });
});
