import { parseEntityId, type ProductId } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import * as menuProductOrder from './menuProductOrder';

function product(index: number): ProductId {
  return parseEntityId<ProductId>(`44444444-4444-4444-8444-${String(index).padStart(12, '0')}`);
}

describe('moveProductWithinCategory', () => {
  it('moves within category slots without disturbing products from other categories', () => {
    expect('moveProductWithinCategory' in menuProductOrder).toBe(true);
    if (!('moveProductWithinCategory' in menuProductOrder)) return;
    const moveProductWithinCategory = menuProductOrder.moveProductWithinCategory;
    expect(moveProductWithinCategory).toBeTypeOf('function');
    if (typeof moveProductWithinCategory !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);
    const drinksA = product(4);
    const burgerC = product(5);

    expect(
      moveProductWithinCategory(
        [burgerA, friesA, burgerB, drinksA, burgerC],
        [burgerA, burgerB, burgerC],
        burgerA,
        burgerC,
      ),
    ).toEqual([burgerB, friesA, burgerC, drinksA, burgerA]);
  });

  it('leaves the order unchanged when either product is outside the selected category', () => {
    expect('moveProductWithinCategory' in menuProductOrder).toBe(true);
    if (!('moveProductWithinCategory' in menuProductOrder)) return;
    const moveProductWithinCategory = menuProductOrder.moveProductWithinCategory;
    expect(moveProductWithinCategory).toBeTypeOf('function');
    if (typeof moveProductWithinCategory !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);

    expect(
      moveProductWithinCategory([burgerA, friesA, burgerB], [burgerA, burgerB], friesA, burgerB),
    ).toEqual([burgerA, friesA, burgerB]);
  });
});

describe('swapProductWithinCategory', () => {
  it('swaps two selected-category slots without shifting intervening products', () => {
    expect('swapProductWithinCategory' in menuProductOrder).toBe(true);
    if (!('swapProductWithinCategory' in menuProductOrder)) return;
    const swapProductWithinCategory = menuProductOrder.swapProductWithinCategory;
    expect(swapProductWithinCategory).toBeTypeOf('function');
    if (typeof swapProductWithinCategory !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);
    const drinksA = product(4);
    const burgerC = product(5);

    expect(
      swapProductWithinCategory(
        [burgerA, friesA, burgerB, drinksA, burgerC],
        [burgerA, burgerB, burgerC],
        burgerA,
        burgerC,
      ),
    ).toEqual([burgerC, friesA, burgerB, drinksA, burgerA]);
  });

  it('leaves the order unchanged when either swap target is outside the selected category', () => {
    expect('swapProductWithinCategory' in menuProductOrder).toBe(true);
    if (!('swapProductWithinCategory' in menuProductOrder)) return;
    const swapProductWithinCategory = menuProductOrder.swapProductWithinCategory;
    expect(swapProductWithinCategory).toBeTypeOf('function');
    if (typeof swapProductWithinCategory !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);
    const order = [burgerA, friesA, burgerB] as const;

    expect(swapProductWithinCategory(order, [burgerA, burgerB], burgerA, friesA)).toBe(order);
  });
});

describe('resetProductCategoryOrder', () => {
  it('restores canonical category slots without disturbing products from other categories', () => {
    expect('resetProductCategoryOrder' in menuProductOrder).toBe(true);
    if (!('resetProductCategoryOrder' in menuProductOrder)) return;
    const resetProductCategoryOrder = menuProductOrder.resetProductCategoryOrder;
    expect(resetProductCategoryOrder).toBeTypeOf('function');
    if (typeof resetProductCategoryOrder !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);
    const drinksA = product(4);
    const burgerC = product(5);

    expect(
      resetProductCategoryOrder(
        [burgerC, friesA, burgerA, drinksA, burgerB],
        [burgerA, burgerB, burgerC],
      ),
    ).toEqual([burgerA, friesA, burgerB, drinksA, burgerC]);
  });
});

describe('moveProductWithinCategoryByOffset', () => {
  it('moves exactly one category slot for keyboard reordering', () => {
    expect('moveProductWithinCategoryByOffset' in menuProductOrder).toBe(true);
    if (!('moveProductWithinCategoryByOffset' in menuProductOrder)) return;
    const moveProductWithinCategoryByOffset = menuProductOrder.moveProductWithinCategoryByOffset;
    expect(moveProductWithinCategoryByOffset).toBeTypeOf('function');
    if (typeof moveProductWithinCategoryByOffset !== 'function') return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);
    const drinksA = product(4);
    const burgerC = product(5);
    const order = [burgerA, friesA, burgerB, drinksA, burgerC] as const;
    const category = [burgerA, burgerB, burgerC] as const;

    expect(moveProductWithinCategoryByOffset(order, category, burgerB, -1)).toEqual([
      burgerB,
      friesA,
      burgerA,
      drinksA,
      burgerC,
    ]);
    expect(moveProductWithinCategoryByOffset(order, category, burgerB, 1)).toEqual([
      burgerA,
      friesA,
      burgerC,
      drinksA,
      burgerB,
    ]);
    expect(moveProductWithinCategoryByOffset(order, category, burgerA, -1)).toBe(order);
    expect(moveProductWithinCategoryByOffset(order, category, burgerC, 1)).toBe(order);
  });
});
