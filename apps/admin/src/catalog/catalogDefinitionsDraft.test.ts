import { describe, expect, it } from 'vitest';
import {
  reorderCatalogDefinitionsInBundle,
  upsertCatalogDefinitionInBundle,
} from './catalogDefinitionsDraft';

const bundle = {
  snapshot: {
    categories: [
      {
        id: 'category-a',
        shopId: 'shop',
        slug: 'burgers',
        name: 'Burgers',
        description: null,
        active: true,
        sortOrder: 10,
      },
    ],
    products: [
      { id: 'product-a', shopId: 'shop', categoryId: 'category-a', name: 'Burger', active: true },
    ],
    modifiers: [
      {
        id: 'modifier-a',
        shopId: 'shop',
        name: 'Cheese',
        priceMinor: 100,
        active: true,
        sortOrder: 10,
      },
    ],
    productModifierLinks: [
      {
        shopId: 'shop',
        productId: 'product-a',
        modifierId: 'modifier-a',
        maxQuantity: 1,
        sortOrder: 10,
      },
    ],
    comboBeverageOptions: [],
    recipeLines: [],
  },
};

describe('catalog definition draft persistence', () => {
  it('reorders even zero-based category positions without ties or partial draft writes', () => {
    const input = {
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        categories: [
          { ...bundle.snapshot.categories[0], sortOrder: 0 },
          { id: 'category-b', shopId: 'shop', name: 'Sides', active: true, sortOrder: 1 },
        ],
      },
    };
    const ordered = reorderCatalogDefinitionsInBundle(input, 'categories', [
      'category-b',
      'category-a',
    ]);
    const categories = (ordered.snapshot as Record<string, unknown>).categories as Array<{
      id: string;
      sortOrder: number;
    }>;
    expect(categories.map((category) => category.id)).toEqual(['category-b', 'category-a']);
    expect(categories.map((category) => category.sortOrder)).toEqual([0, 10]);
    expect((input.snapshot.categories as Array<{ id: string }>)[0]?.id).toBe('category-a');
    expect(() =>
      reorderCatalogDefinitionsInBundle(input, 'categories', ['category-b', 'category-b']),
    ).toThrow();
  });

  it('reorders modifier definitions without dropping existing product links', () => {
    const input = {
      ...bundle,
      snapshot: {
        ...bundle.snapshot,
        modifiers: [
          ...bundle.snapshot.modifiers,
          {
            id: 'modifier-b',
            shopId: 'shop',
            name: 'Bacon',
            priceMinor: 250,
            active: true,
            sortOrder: 20,
          },
        ],
      },
    };
    const result = reorderCatalogDefinitionsInBundle(input, 'modifiers', [
      'modifier-b',
      'modifier-a',
    ]);
    const snapshot = result.snapshot as Record<string, unknown>;
    const modifiers = snapshot.modifiers as Array<{ id: string; sortOrder: number }>;
    expect(modifiers.map(({ id, sortOrder }) => ({ id, sortOrder }))).toEqual([
      { id: 'modifier-b', sortOrder: 0 },
      { id: 'modifier-a', sortOrder: 10 },
    ]);
    expect(snapshot.productModifierLinks).toEqual(bundle.snapshot.productModifierLinks);
    expect(input.snapshot.modifiers[0]?.id).toBe('modifier-a');
  });

  it('creates or renames categories only in the canonical catalog snapshot', () => {
    const updated = upsertCatalogDefinitionInBundle(bundle, 'categories', {
      id: 'category-b',
      shopId: 'shop',
      slug: 'sides',
      name: 'Sides',
      description: null,
      active: true,
      sortOrder: 20,
    });
    const snapshot = updated.snapshot as Record<string, unknown>;
    expect((snapshot.categories as unknown[]).length).toBe(2);
    expect(snapshot.products).toEqual(bundle.snapshot.products);
    expect(bundle.snapshot.categories).toHaveLength(1);
  });
  it('archives a used modifier without destroying historical links', () => {
    const updated = upsertCatalogDefinitionInBundle(bundle, 'modifiers', {
      ...bundle.snapshot.modifiers[0]!,
      active: false,
    });
    const snapshot = updated.snapshot as Record<string, unknown>;
    expect(snapshot.productModifierLinks).toEqual(bundle.snapshot.productModifierLinks);
    expect((snapshot.modifiers as Array<{ active: boolean }>)[0]?.active).toBe(false);
  });
  it('rejects cross-shop edits and unknown definitions without a payload', () => {
    expect(() =>
      upsertCatalogDefinitionInBundle(bundle, 'categories', {
        id: 'other',
        shopId: 'wrong',
        name: 'Other',
        slug: null,
        description: null,
        active: true,
        sortOrder: 20,
      }),
    ).toThrow();
  });
});
