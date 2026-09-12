import type { CatalogProductDetail } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProductEditor, formatEgpMinor, parseEgpToMinor } from './ProductEditor';

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
});
