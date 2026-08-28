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
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as productPositionEditor from './ProductPositionEditor';

const { ProductPositionEditor } = productPositionEditor;

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const categoryId = parseEntityId<MenuCategoryId>('33333333-3333-4333-8333-333333333333');

const category: MenuCategory = {
  id: categoryId,
  shopId,
  name: 'Burgers',
  sortOrder: 0,
  active: true,
};

function product(index: number, name: string): Product {
  return {
    id: parseEntityId<ProductId>(`44444444-4444-4444-8444-${String(index).padStart(12, '0')}`),
    shopId,
    categoryId,
    name,
    description: null,
    priceMinor: 0 as Product['priceMinor'],
    imageKey: null,
    family: null,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: index - 1,
  };
}

const products = [product(1, 'Single Burger'), product(2, 'Double Burger')];

const preference: WorkerUiPreferences = {
  shopId,
  workerId,
  categoryOrder: [],
  categoryAlignment: 'left',
  productOrder: [products[1]!.id, products[0]!.id],
  updatedAt: instant(new Date('2026-08-28T06:00:00.000Z')),
  serverVersion: 1,
  syncState: 'CLEAN',
};

describe('ProductPositionEditor', () => {
  it('renders the approved one-category reorder surface without cashier actions', () => {
    const markup = renderToStaticMarkup(
      <ProductPositionEditor
        category={category}
        products={products}
        preference={preference}
        preferenceClient={{
          update: async () => preference,
        }}
        onSaved={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('Reordering Burgers');
    expect(markup).toContain('Drag cards or use the move controls');
    expect(markup).toContain('Double Burger');
    expect(markup.indexOf('Double Burger')).toBeLessThan(markup.indexOf('Single Burger'));
    expect(markup).toContain('Move Double Burger earlier');
    expect(markup).toContain('Move Double Burger later');
    expect(markup).toContain('Reset');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Save');
    expect(markup).toContain('style="display:flex;flex-direction:column"');
    expect(markup).toContain('style="flex:1"');
    expect(markup).not.toContain('Extra');
    expect(markup).not.toContain('Add one');
  });

  it('handles pickup keyboard commands only when the card itself owns the event', () => {
    expect('shouldHandleProductReorderCardKeyEvent' in productPositionEditor).toBe(true);
    if (!('shouldHandleProductReorderCardKeyEvent' in productPositionEditor)) return;

    const shouldHandle = productPositionEditor.shouldHandleProductReorderCardKeyEvent;
    expect(shouldHandle).toBeTypeOf('function');
    if (typeof shouldHandle !== 'function') return;

    const card = {};
    const childButton = {};
    expect(shouldHandle(card, card)).toBe(true);
    expect(shouldHandle(childButton, card)).toBe(false);
  });
});
