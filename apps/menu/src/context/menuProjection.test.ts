import type { PublicCatalogSnapshotV1 } from '@tux/catalog-contracts';
import { describe, expect, it } from 'vitest';
import { projectPublicCatalog } from './menuProjection';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const COMBO_ID = '33333333-3333-4333-8333-333333333333';
const COLA_ID = '44444444-4444-4444-8444-444444444444';
const WATER_ID = '55555555-5555-4555-8555-555555555555';

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
