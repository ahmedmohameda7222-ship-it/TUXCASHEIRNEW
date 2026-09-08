import { describe, expect, it } from 'vitest';
import {
  CatalogContractError,
  parseCatalogAdminCommandV1,
  parseCatalogErrorV1,
  parsePublicCatalogSnapshotV1,
} from './index';
import { parseCatalogAdminSuccessV1 } from './adminResponse';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const MODIFIER_ID = '44444444-4444-4444-8444-444444444444';
const COMMAND_ID = '55555555-5555-4555-8555-555555555555';

function validSnapshot() {
  return {
    schemaVersion: 1,
    shopId: SHOP_ID,
    revision: 'a'.repeat(64),
    categories: [
      {
        id: CATEGORY_ID,
        slug: 'tux-burger',
        name: 'TUX Burger',
        description: 'Burgers',
        active: true,
        sortOrder: 1,
      },
    ],
    products: [
      {
        id: PRODUCT_ID,
        slug: 'single-tux-burger',
        categoryId: CATEGORY_ID,
        name: 'Single TUX Burger',
        description: null,
        priceMinor: 19000,
        imageUrl: null,
        bestSeller: true,
        active: true,
        soldOut: false,
        isCombo: false,
        sortOrder: 1,
      },
    ],
    modifiers: [
      { id: MODIFIER_ID, name: 'Extra cheese', priceMinor: 2000, active: true, sortOrder: 1 },
    ],
    productModifierLinks: [
      { productId: PRODUCT_ID, modifierId: MODIFIER_ID, maxQuantity: 2, sortOrder: 1 },
    ],
    comboBeverageOptions: [],
  };
}

describe('PublicCatalogSnapshotV1', () => {
  it('parses a complete V1 customer-safe snapshot', () =>
    expect(parsePublicCatalogSnapshotV1(validSnapshot())).toEqual(validSnapshot()));

  it('preserves canonical standalone product identity for customer-selectable modifiers', () => {
    const snapshot = validSnapshot();
    const withStandaloneIdentity = {
      ...snapshot,
      modifiers: [
        {
          ...snapshot.modifiers[0],
          standaloneProductId: PRODUCT_ID,
        },
      ],
    };

    expect(parsePublicCatalogSnapshotV1(withStandaloneIdentity)).toEqual(withStandaloneIdentity);
  });

  it('rejects unknown schema versions', () =>
    expect(() => parsePublicCatalogSnapshotV1({ ...validSnapshot(), schemaVersion: 2 })).toThrow(
      CatalogContractError,
    ));
  it('rejects malformed UUID identity', () =>
    expect(() =>
      parsePublicCatalogSnapshotV1({ ...validSnapshot(), shopId: 'not-a-uuid' }),
    ).toThrow(/shopId/));
  it('rejects missing required fields', () => {
    const snapshot = validSnapshot();
    const product = { ...snapshot.products[0] } as Record<string, unknown>;
    delete product.slug;
    expect(() => parsePublicCatalogSnapshotV1({ ...snapshot, products: [product] })).toThrow(
      /slug/,
    );
  });
  it('rejects negative priceMinor', () => {
    const snapshot = validSnapshot();
    expect(() =>
      parsePublicCatalogSnapshotV1({
        ...snapshot,
        products: [{ ...snapshot.products[0], priceMinor: -1 }],
      }),
    ).toThrow(/priceMinor/);
  });
  it('rejects unsafe integer money', () => {
    const snapshot = validSnapshot();
    expect(() =>
      parsePublicCatalogSnapshotV1({
        ...snapshot,
        products: [{ ...snapshot.products[0], priceMinor: Number.MAX_SAFE_INTEGER + 1 }],
      }),
    ).toThrow(/priceMinor/);
  });
});

describe('CatalogErrorV1', () => {
  it('parses a stable public error', () =>
    expect(
      parseCatalogErrorV1({ schemaVersion: 1, error: { code: 'catalog_read_failed' } }),
    ).toEqual({ schemaVersion: 1, error: { code: 'catalog_read_failed' } }));
  it('rejects unknown error codes instead of leaking arbitrary backend text', () =>
    expect(() =>
      parseCatalogErrorV1({
        schemaVersion: 1,
        error: { code: 'postgres connection refused: secret detail' },
      }),
    ).toThrow(/error.code/));
});

describe('CatalogAdminCommandV1', () => {
  it('parses OWNER/ADMIN-neutral product mutation commands without any client role field', () => {
    const command = {
      schemaVersion: 1,
      shopId: SHOP_ID,
      commandId: COMMAND_ID,
      command: {
        type: 'product.update',
        productId: PRODUCT_ID,
        patch: {
          description: 'Updated',
          priceMinor: 20000,
          active: true,
          soldOut: false,
          bestSeller: true,
          sortOrder: 2,
        },
      },
    };
    expect(parseCatalogAdminCommandV1(command)).toEqual(command);
  });

  it('rejects role spoofing fields in a command envelope', () => {
    expect(() =>
      parseCatalogAdminCommandV1({
        schemaVersion: 1,
        shopId: SHOP_ID,
        commandId: COMMAND_ID,
        role: 'OWNER',
        command: { type: 'category.retire', categoryId: CATEGORY_ID },
      }),
    ).toThrow(/unexpected field/);
  });

  it('rejects malformed canonical money in admin commands', () => {
    expect(() =>
      parseCatalogAdminCommandV1({
        schemaVersion: 1,
        shopId: SHOP_ID,
        commandId: COMMAND_ID,
        command: {
          type: 'product.create',
          product: {
            id: PRODUCT_ID,
            categoryId: CATEGORY_ID,
            slug: 'single-tux-burger',
            name: 'Single TUX Burger',
            description: null,
            priceMinor: Number.NaN,
            imageKey: null,
            bestSeller: false,
            active: true,
            soldOut: false,
            isCombo: false,
            sortOrder: 1,
          },
        },
      }),
    ).toThrow(/priceMinor/);
  });
});

describe('CatalogAdminSuccessV1', () => {
  it('parses a stable command result envelope', () => {
    const response = {
      schemaVersion: 1,
      commandId: COMMAND_ID,
      ok: true,
      result: { status: 'applied' },
    };
    expect(parseCatalogAdminSuccessV1(response)).toEqual(response);
  });
  it('rejects extra top-level response fields', () =>
    expect(() =>
      parseCatalogAdminSuccessV1({
        schemaVersion: 1,
        commandId: COMMAND_ID,
        ok: true,
        result: {},
        internalSql: 'secret',
      }),
    ).toThrow(/unexpected field/));
});
