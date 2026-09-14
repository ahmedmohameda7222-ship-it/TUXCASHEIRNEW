import type { CatalogJsonObject, CatalogProductDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductEditor, formatEgpMinor, parseEgpToMinor } from './ProductEditor';
import { applyProductAdvancedDraft } from './catalogAdvancedDraft';

const fixtureProduct: CatalogProductDetail = {
  id: '11111111-1111-4111-8111-111111111111',
  shopId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  categoryId: '22222222-2222-4222-8222-222222222222',
  slug: 'classic-smash',
  name: 'Classic Smash',
  description: 'Single smashed burger',
  priceMinor: 1550,
  imageKey: 'products/classic-smash.png',
  family: 'burger',
  bestSeller: true,
  active: true,
  soldOut: false,
  isCombo: false,
  sortOrder: 10,
};

describe('ProductEditor', () => {
  it('keeps advanced fields behind progressive disclosure', () => {
    const collapsed = renderToStaticMarkup(
      <ProductEditor
        product={fixtureProduct}
        canEdit
        canPrice
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );
    expect(collapsed).toContain('Price');
    expect(collapsed).toContain('More');
    expect(collapsed).not.toContain('Recipe / Inventory');

    const expanded = renderToStaticMarkup(
      <ProductEditor
        product={fixtureProduct}
        canEdit
        canPrice
        initialAdvancedOpen
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );
    expect(expanded).toContain('Recipe / Inventory');
    expect(expanded).toContain('Extras / Modifiers');
    expect(expanded).toContain('Shop Overrides');
    expect(expanded).toContain('History');
  });

  it('keeps pricing read-only without catalog.pricing', () => {
    const html = renderToStaticMarkup(
      <ProductEditor
        product={fixtureProduct}
        canEdit
        canPrice={false}
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );
    expect(html).toContain('data-catalog-price-readonly="true"');
    expect(html).toContain('15.50');
  });

  it('labels normal removal as archive and immediate availability as live', () => {
    const html = renderToStaticMarkup(
      <ProductEditor
        product={fixtureProduct}
        canEdit
        canPrice
        onSaveDraft={vi.fn()}
        onSetAvailability={vi.fn()}
      />,
    );
    expect(html).toContain('Archive product');
    expect(html).not.toContain('Delete product');
    expect(html).toContain('This change goes live immediately.');
    expect(html).toContain('Mark sold out');
  });

  it('converts displayed EGP values to integer minor units without float drift', () => {
    expect(formatEgpMinor(1550)).toBe('15.50');
    expect(parseEgpToMinor('15.50')).toBe(1550);
    expect(parseEgpToMinor('15.5')).toBe(1550);
    expect(() => parseEgpToMinor('-1')).toThrow(/invalid_price/);
    expect(() => parseEgpToMinor('12.345')).toThrow(/invalid_price/);
  });

  it('replaces only this product advanced relations in the draft bundle', () => {
    const otherProductId = '33333333-3333-4333-8333-333333333333';
    const modifierId = '44444444-4444-4444-8444-444444444444';
    const beverageId = '55555555-5555-4555-8555-555555555555';
    const inventoryItemId = '66666666-6666-4666-8666-666666666666';
    const bundle: CatalogJsonObject = {
      snapshot: {
        products: [],
        modifiers: [],
        productModifierLinks: [
          {
            shopId: fixtureProduct.shopId,
            productId: otherProductId,
            modifierId,
            maxQuantity: 1,
            sortOrder: 0,
          },
          {
            shopId: fixtureProduct.shopId,
            productId: fixtureProduct.id,
            modifierId,
            maxQuantity: 1,
            sortOrder: 0,
          },
        ],
        comboBeverageOptions: [
          {
            shopId: fixtureProduct.shopId,
            comboProductId: otherProductId,
            beverageProductId: beverageId,
            sortOrder: 0,
          },
        ],
        recipeLines: [
          {
            shopId: fixtureProduct.shopId,
            productId: otherProductId,
            inventoryItemId,
            quantityMicros: 1000000,
          },
        ],
      },
      inventoryItems: [],
    };

    const result = applyProductAdvancedDraft(bundle, fixtureProduct.id, {
      modifierLinks: [
        {
          shopId: fixtureProduct.shopId,
          productId: fixtureProduct.id,
          modifierId,
          maxQuantity: 2,
          sortOrder: 0,
        },
      ],
      comboBeverageOptions: [
        {
          shopId: fixtureProduct.shopId,
          comboProductId: fixtureProduct.id,
          beverageProductId: beverageId,
          sortOrder: 0,
        },
      ],
      recipeLines: [
        {
          shopId: fixtureProduct.shopId,
          productId: fixtureProduct.id,
          inventoryItemId,
          quantityMicros: 250000,
        },
      ],
    });

    const snapshot = result.bundleJson.snapshot as CatalogJsonObject;
    expect(snapshot.productModifierLinks).toEqual([
      {
        shopId: fixtureProduct.shopId,
        productId: otherProductId,
        modifierId,
        maxQuantity: 1,
        sortOrder: 0,
      },
      {
        shopId: fixtureProduct.shopId,
        productId: fixtureProduct.id,
        modifierId,
        maxQuantity: 2,
        sortOrder: 0,
      },
    ]);
    expect(snapshot.comboBeverageOptions).toEqual([
      {
        shopId: fixtureProduct.shopId,
        comboProductId: otherProductId,
        beverageProductId: beverageId,
        sortOrder: 0,
      },
      {
        shopId: fixtureProduct.shopId,
        comboProductId: fixtureProduct.id,
        beverageProductId: beverageId,
        sortOrder: 0,
      },
    ]);
    expect(snapshot.recipeLines).toEqual([
      {
        shopId: fixtureProduct.shopId,
        productId: otherProductId,
        inventoryItemId,
        quantityMicros: 1000000,
      },
      {
        shopId: fixtureProduct.shopId,
        productId: fixtureProduct.id,
        inventoryItemId,
        quantityMicros: 250000,
      },
    ]);
    expect(result.changedPaths).toEqual([
      'productModifierLinks',
      'comboBeverageOptions',
      'recipeLines',
    ]);
  });
});
