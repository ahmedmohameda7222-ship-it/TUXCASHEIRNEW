import { parseEntityId, type ProductId } from '@tux/domain';
import { describe, expect, it } from 'vitest';
import * as menuProductOrder from './menuProductOrder';

type MoveProductWithinCategory = (
  order: readonly ProductId[],
  categoryProductIds: readonly ProductId[],
  sourceId: ProductId,
  targetId: ProductId,
) => readonly ProductId[];

const moveProductWithinCategory = (
  menuProductOrder as unknown as { moveProductWithinCategory?: MoveProductWithinCategory }
).moveProductWithinCategory;

function product(index: number): ProductId {
  return parseEntityId<ProductId>(`44444444-4444-4444-8444-${String(index).padStart(12, '0')}`);
}

describe('moveProductWithinCategory', () => {
  it('moves within category slots without disturbing products from other categories', () => {
    expect(moveProductWithinCategory).toBeTypeOf('function');
    if (moveProductWithinCategory === undefined) return;

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
    expect(moveProductWithinCategory).toBeTypeOf('function');
    if (moveProductWithinCategory === undefined) return;

    const burgerA = product(1);
    const friesA = product(2);
    const burgerB = product(3);

    expect(
      moveProductWithinCategory(
        [burgerA, friesA, burgerB],
        [burgerA, burgerB],
        friesA,
        burgerB,
      ),
    ).toEqual([burgerA, friesA, burgerB]);
  });
});
