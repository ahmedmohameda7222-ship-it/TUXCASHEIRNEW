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
import { productFamiliesForCategory, reconcileCategoryOrder } from './OrdersWorkspace';
import { filterProductsForMenu } from './menuProductOrder';

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
    id: parseEntityId<ProductId>(`44444444-4444-4444-8444-${String(index).padStart(12, '0')}`),
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

function preference(
  categoryOrder: readonly MenuCategoryId[],
  productOrder: readonly ProductId[] = [],
): WorkerUiPreferences {
  return {
    shopId,
    workerId,
    categoryOrder,
    categoryAlignment: 'right',
    productOrder,
    accentColor: null,
    serverVersion: 4,
    updatedAt: instant(new Date('2026-08-25T04:00:00.000Z')),
    syncState: 'CLEAN',
  };
}

describe('reconcileCategoryOrder', () => {
  it('keeps saved active categories first and appends newly active configuration categories', () => {
    const staleId = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-999999999999');

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
        name: 'Classic Smash',
        categoryId: burgers.id,
        family: 'Classic',
        sortOrder: 2,
      }),
      product(4, {
        name: 'Hidden burger',
        categoryId: burgers.id,
        family: 'Hidden',
        sortOrder: 3,
        active: false,
      }),
      product(5, {
        name: 'Fries',
        categoryId: sides.id,
        family: 'Sides',
        sortOrder: 0,
      }),
    ];

    expect(productFamiliesForCategory(products, burgers.id)).toEqual(['TUX', 'Classic']);
  });
});

describe('menu product ordering', () => {
  it('keeps the worker order while filtering to the selected category', () => {
    const burgerA = product(1, {
      name: 'Burger A',
      categoryId: burgers.id,
      sortOrder: 0,
    });
    const burgerB = product(2, {
      name: 'Burger B',
      categoryId: burgers.id,
      sortOrder: 1,
    });
    const fries = product(3, {
      name: 'Fries',
      categoryId: sides.id,
      sortOrder: 0,
    });

    expect(
      filterProductsForMenu(
        [burgerA, burgerB, fries],
        burgers.id,
        null,
        preference([], [fries.id, burgerB.id, burgerA.id]),
      ).map((item) => item.name),
    ).toEqual(['Burger B', 'Burger A']);
  });
});
