import {
  instant,
  parseEntityId,
  type MenuCategory,
  type MenuCategoryId,
  type Product,
  type ProductId,
  type ShopId,
  type WorkerId,
  type WorkerUiPreferences,
} from '@tux/domain';
import { describe, expect, it } from 'vitest';
import {
  filterProductsForMenu,
  productFamiliesForCategory,
  reconcileCategoryOrder,
} from './OrdersWorkspace';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');

function category(index: number, name: string): MenuCategory {
  return {
    id: parseEntityId<MenuCategoryId>(`33333333-3333-4333-8333-${String(index).padStart(12, '0')}`),
    shopId,
    name,
    sortOrder: index - 1,
    active: true,
  };
}

function product(
  index: number,
  options: {
    readonly name: string;
    readonly categoryId: MenuCategoryId;
    readonly family?: string | null;
    readonly sortOrder: number;
    readonly active?: boolean;
  },
): Product {
  return {
    id: parseEntityId<ProductId>(
      `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    ),
    shopId,
    categoryId: options.categoryId,
    name: options.name,
    description: null,
    priceMinor: 0 as Product['priceMinor'],
    imageKey: null,
    family: options.family ?? null,
    active: options.active ?? true,
    soldOut: false,
    isCombo: false,
    sortOrder: options.sortOrder,
  };
}

const burgers = category(1, 'Burgers');
const sides = category(2, 'Sides');
const drinks = category(3, 'Drinks');

function preference(categoryOrder: readonly MenuCategoryId[]): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: 'right',
    serverVersion: 4,
    updatedAt: instant(new Date('2026-08-25T04:00:00.000Z')),
    syncState: 'CLEAN',
  };
}

describe('reconcileCategoryOrder', () => {
  it('keeps saved active categories first and appends newly active configuration categories', () => {
    const staleId = parseEntityId<MenuCategoryId>(
      '33333333-3333-4333-8333-999999999999',
    );

    expect(
      reconcileCategoryOrder(
        [burgers, sides, drinks],
        preference([drinks.id, staleId, burgers.id]),
      ).map((item) => item.name),
    ).toEqual(['Drinks', 'Burgers', 'Sides']);
  });

  it('uses configuration order when the worker has no saved preference', () => {
    expect(reconcileCategoryOrder([burgers, sides, drinks], null)).toEqual([
      burgers,
      sides,
      drinks,
    ]);
  });
});

describe('productFamiliesForCategory', () => {
  it('derives ordered contextual families only from active products in the selected category', () => {
    const products = [
      product(1, {
        name: 'Single Smashed Patty',
        categoryId: burgers.id,
        family: 'TUX',
        sortOrder: 0,
      }),
      product(2, {
        name: 'Double Smashed Patty',
        categoryId: burgers.id,
        family: 'TUX',
        sortOrder: 1,
      }),
      product(3, {
        name: 'Single TUXIFY',
        categoryId: burgers.id,
        family: 'TUXIFY',
        sortOrder: 2,
      }),
      product(4, { name: "Johnny's", categoryId: burgers.id, family: null, sortOrder: 3 }),
      product(5, {
        name: 'Blank family',
        categoryId: burgers.id,
        family: '   ',
        sortOrder: 4,
      }),
      product(6, {
        name: 'Inactive family',
        categoryId: burgers.id,
        family: 'HIDDEN',
        sortOrder: 5,
        active: false,
      }),
      product(7, { name: 'Soda', categoryId: drinks.id, family: 'DRINKS', sortOrder: 6 }),
    ];

    expect(productFamiliesForCategory(products, burgers.id)).toEqual(['TUX', 'TUXIFY']);
    expect(productFamiliesForCategory(products, null)).toEqual([]);
  });
});

describe('filterProductsForMenu', () => {
  const products = [
    product(1, {
      name: 'Single Smashed Patty',
      categoryId: burgers.id,
      family: 'TUX',
      sortOrder: 0,
    }),
    product(2, {
      name: 'Single TUXIFY',
      categoryId: burgers.id,
      family: 'TUXIFY',
      sortOrder: 1,
    }),
    product(3, { name: "Johnny's", categoryId: burgers.id, family: null, sortOrder: 2 }),
    product(4, { name: 'Soda', categoryId: drinks.id, family: null, sortOrder: 3 }),
  ];

  it('shows every active product in the selected category when the secondary filter is All', () => {
    expect(
      filterProductsForMenu(products, {
        selectedCategoryId: burgers.id,
        selectedFamily: null,
        search: '',
      }).map((item) => item.name),
    ).toEqual(['Single Smashed Patty', 'Single TUXIFY', "Johnny's"]);
  });

  it('filters the selected category by family', () => {
    expect(
      filterProductsForMenu(products, {
        selectedCategoryId: burgers.id,
        selectedFamily: 'TUXIFY',
        search: '',
      }).map((item) => item.name),
    ).toEqual(['Single TUXIFY']);
  });

  it('keeps search global instead of constraining it to the selected category or family', () => {
    expect(
      filterProductsForMenu(products, {
        selectedCategoryId: burgers.id,
        selectedFamily: 'TUX',
        search: 'soda',
      }).map((item) => item.name),
    ).toEqual(['Soda']);
  });

  it('shows no products without a selected top-level category when search is empty', () => {
    expect(
      filterProductsForMenu(products, {
        selectedCategoryId: null,
        selectedFamily: null,
        search: '',
      }),
    ).toEqual([]);
  });
});
