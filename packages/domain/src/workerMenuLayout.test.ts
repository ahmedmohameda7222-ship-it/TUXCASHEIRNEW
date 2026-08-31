import { describe, expect, it } from 'vitest';
import {
  instant,
  normalizeWorkerMenuLayoutUpdate,
  parseEntityId,
  parseWorkerMenuLayout,
  reconcileWorkerMenuLayout,
  type MenuCategory,
  type MenuCategoryId,
  type Product,
  type ProductId,
  type ShopId,
  type WorkerId,
} from './index';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const categoryA = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001');
const categoryB = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000002');
const categoryRemoved = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000003');
const productA1 = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000001');
const productA2 = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000002');
const productB1 = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000003');
const productRemoved = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000004');

function category(id: MenuCategoryId, sortOrder: number, active = true): MenuCategory {
  return { id, shopId, name: id, sortOrder, active };
}

function product(
  id: ProductId,
  categoryId: MenuCategoryId,
  sortOrder: number,
  active = true,
): Product {
  return {
    id,
    shopId,
    categoryId,
    name: id,
    description: null,
    priceMinor: 100 as Product['priceMinor'],
    imageKey: null,
    active,
    soldOut: false,
    isCombo: false,
    sortOrder,
  };
}

const catalog = {
  categories: [category(categoryA, 0), category(categoryB, 1), category(categoryRemoved, 2, false)],
  products: [
    product(productA1, categoryA, 0),
    product(productA2, categoryA, 1),
    product(productB1, categoryB, 0),
    product(productRemoved, categoryRemoved, 0, false),
  ],
};

function layout() {
  return parseWorkerMenuLayout({
    shopId,
    workerId,
    categoryOrder: [categoryB, categoryA, categoryRemoved],
    categoryAlignment: 'right',
    productOrderByCategory: {
      [categoryA]: [productA2, productA1],
      [categoryB]: [productB1],
      [categoryRemoved]: [productRemoved],
    },
    layoutVersion: 4,
    updatedAt: '2026-08-31T10:00:00.000Z',
    syncState: 'CLEAN',
  });
}

describe('WorkerMenuLayout', () => {
  it('rejects duplicate categories and duplicate products across category mappings', () => {
    expect(() =>
      parseWorkerMenuLayout({
        ...layout(),
        categoryOrder: [categoryA, categoryA],
      }),
    ).toThrow(/duplicate category/i);

    expect(() =>
      parseWorkerMenuLayout({
        ...layout(),
        productOrderByCategory: {
          [categoryA]: [productA1],
          [categoryB]: [productA1],
        },
      }),
    ).toThrow(/more than once/i);
  });

  it('rejects malformed productOrderByCategory values', () => {
    expect(() =>
      parseWorkerMenuLayout({
        ...layout(),
        productOrderByCategory: { [categoryA]: 'not-an-array' },
      }),
    ).toThrow(/must be an array/i);
  });

  it('preserves worker order while appending new products and removing unavailable catalog entries', () => {
    const reconciled = reconcileWorkerMenuLayout(layout(), catalog);
    expect(reconciled.categoryOrder).toEqual([categoryB, categoryA]);
    expect(reconciled.productOrderByCategory[categoryA]).toEqual([productA2, productA1]);
    expect(reconciled.productOrderByCategory[categoryB]).toEqual([productB1]);
    expect(reconciled.productOrderByCategory[categoryRemoved]).toBeUndefined();

    const withNewProduct = reconcileWorkerMenuLayout(reconciled, {
      ...catalog,
      products: [
        ...catalog.products,
        product(parseEntityId<ProductId>('40000000-0000-4000-8000-000000000005'), categoryA, 2),
      ],
    });
    expect(withNewProduct.productOrderByCategory[categoryA]?.slice(0, 2)).toEqual([
      productA2,
      productA1,
    ]);
    expect(withNewProduct.productOrderByCategory[categoryA]).toHaveLength(3);
  });

  it('appends newly active categories without resetting customized category order', () => {
    const newCategory = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000004');
    const reconciled = reconcileWorkerMenuLayout(layout(), {
      categories: [...catalog.categories, category(newCategory, 3)],
      products: catalog.products,
    });
    expect(reconciled.categoryOrder).toEqual([categoryB, categoryA, newCategory]);
  });

  it('rejects a local draft that puts an active product under the wrong real category', () => {
    expect(() =>
      normalizeWorkerMenuLayoutUpdate({
        shopId,
        workerId,
        update: {
          categoryOrder: [categoryA, categoryB],
          categoryAlignment: 'left',
          productOrderByCategory: { [categoryB]: [productA1] },
        },
        catalog,
        layoutVersion: 0,
        updatedAt: instant('2026-08-31T11:00:00.000Z'),
        syncState: 'DIRTY',
      }),
    ).toThrow(/belongs to category/i);
  });
});
