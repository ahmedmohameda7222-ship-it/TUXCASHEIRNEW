import type { PublicCatalogSnapshotV1 } from '@tux/catalog-contracts';
import { describe, expect, it } from 'vitest';
import { projectPublicCatalog } from './menuProjection';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const COMBO_ID = '33333333-3333-4333-8333-333333333333';
const COLA_ID = '44444444-4444-4444-8444-444444444444';
const WATER_ID = '55555555-5555-4555-8555-555555555555';
const PRODUCT_A_ID = '66666666-6666-4666-8666-666666666666';
const PRODUCT_B_ID = '77777777-7777-4777-8777-777777777777';
const EXTRA_A_ID = '88888888-8888-4888-8888-888888888888';
const EXTRA_B_ID = '99999999-9999-4999-8999-999999999999';
const UNRELATED_EXTRA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MODIFIER_A_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MODIFIER_B_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function snapshot(input: {
  readonly colaActive: boolean;
  readonly colaSoldOut: boolean;
  readonly waterActive: boolean;
  readonly waterSoldOut: boolean;
}): PublicCatalogSnapshotV1 {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    revision: 'a'.repeat(64),
    categories: [
      {
        id: CATEGORY_ID,
        slug: 'combos',
        name: 'Combos',
        description: null,
        active: true,
        sortOrder: 0,
      },
    ],
    products: [
      {
        id: COMBO_ID,
        slug: 'combo-one',
        categoryId: CATEGORY_ID,
        name: 'Combo One',
        description: null,
        priceMinor: 25_000,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: true,
        sortOrder: 0,
      },
      {
        id: COLA_ID,
        slug: 'cola',
        categoryId: CATEGORY_ID,
        name: 'Cola',
        description: null,
        priceMinor: 0,
        imageUrl: null,
        bestSeller: false,
        active: input.colaActive,
        soldOut: input.colaSoldOut,
        isCombo: false,
        sortOrder: 1,
      },
      {
        id: WATER_ID,
        slug: 'water',
        categoryId: CATEGORY_ID,
        name: 'Water',
        description: null,
        priceMinor: 0,
        imageUrl: null,
        bestSeller: false,
        active: input.waterActive,
        soldOut: input.waterSoldOut,
        isCombo: false,
        sortOrder: 2,
      },
    ],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [
      { comboProductId: COMBO_ID, beverageProductId: COLA_ID, sortOrder: 0 },
      { comboProductId: COMBO_ID, beverageProductId: WATER_ID, sortOrder: 1 },
    ],
  };
}

function extrasSnapshot(): PublicCatalogSnapshotV1 {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    revision: 'b'.repeat(64),
    categories: [
      {
        id: CATEGORY_ID,
        slug: 'burgers',
        name: 'Burgers',
        description: null,
        active: true,
        sortOrder: 0,
      },
    ],
    products: [
      {
        id: PRODUCT_A_ID,
        slug: 'burger-a',
        categoryId: CATEGORY_ID,
        name: 'Burger A',
        description: null,
        priceMinor: 19_000,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 0,
      },
      {
        id: PRODUCT_B_ID,
        slug: 'burger-b',
        categoryId: CATEGORY_ID,
        name: 'Burger B',
        description: null,
        priceMinor: 22_000,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 1,
      },
      {
        id: EXTRA_A_ID,
        slug: 'extra-cheese-product',
        categoryId: CATEGORY_ID,
        name: 'Standalone Cheese Product',
        description: null,
        priceMinor: 9_999,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 2,
      },
      {
        id: EXTRA_B_ID,
        slug: 'extra-mushroom-product',
        categoryId: CATEGORY_ID,
        name: 'Standalone Mushroom Product',
        description: null,
        priceMinor: 8_888,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 3,
      },
      {
        id: UNRELATED_EXTRA_ID,
        slug: 'unrelated-extra',
        categoryId: CATEGORY_ID,
        name: 'Unrelated Extra',
        description: null,
        priceMinor: 777,
        imageUrl: null,
        bestSeller: false,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 4,
      },
    ],
    modifiers: [
      {
        id: MODIFIER_A_ID,
        name: 'Extra cheese',
        priceMinor: 2_500,
        active: true,
        sortOrder: 0,
        standaloneProductId: EXTRA_A_ID,
      },
      {
        id: MODIFIER_B_ID,
        name: 'Extra mushroom',
        priceMinor: 3_000,
        active: true,
        sortOrder: 1,
        standaloneProductId: EXTRA_B_ID,
      },
    ],
    productModifierLinks: [
      { productId: PRODUCT_A_ID, modifierId: MODIFIER_A_ID, maxQuantity: 1, sortOrder: 0 },
      { productId: PRODUCT_B_ID, modifierId: MODIFIER_B_ID, maxQuantity: 1, sortOrder: 0 },
    ],
    comboBeverageOptions: [],
  } as unknown as PublicCatalogSnapshotV1;
}

describe('canonical Menu combo availability projection', () => {
  it('offers only currently customer-available configured beverages', () => {
    const projection = projectPublicCatalog(
      snapshot({
        colaActive: true,
        colaSoldOut: false,
        waterActive: false,
        waterSoldOut: false,
      }),
    );

    expect(projection.comboBeveragesByProduct[COMBO_ID]?.map((product) => product.id)).toEqual([
      COLA_ID,
    ]);
    expect(projection.products.find((product) => product.id === COMBO_ID)?.is_active).toBe(true);
  });

  it('marks a configured combo unavailable when every eligible beverage is unavailable', () => {
    const projection = projectPublicCatalog(
      snapshot({
        colaActive: false,
        colaSoldOut: false,
        waterActive: true,
        waterSoldOut: true,
      }),
    );

    expect(projection.comboBeveragesByProduct[COMBO_ID]).toEqual([]);
    expect(projection.products.find((product) => product.id === COMBO_ID)?.is_active).toBe(false);
  });
});

describe('canonical Menu product-specific extras projection', () => {
  it('authorizes only linked standalone modifier products and uses modifier pricing', () => {
    const projection = projectPublicCatalog(extrasSnapshot());
    const extrasByProduct = (
      projection as unknown as {
        readonly extrasByProduct: Readonly<
          Record<string, readonly { id: string; name: string; price: number }[]>
        >;
      }
    ).extrasByProduct;

    expect(extrasByProduct).toEqual({
      [PRODUCT_A_ID]: [{ id: EXTRA_A_ID, name: 'Extra cheese', price: 25 }],
      [PRODUCT_B_ID]: [{ id: EXTRA_B_ID, name: 'Extra mushroom', price: 30 }],
    });
    expect(JSON.stringify(extrasByProduct)).not.toContain(UNRELATED_EXTRA_ID);
  });
});
