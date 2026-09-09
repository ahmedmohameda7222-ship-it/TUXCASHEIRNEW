import { describe, expect, it } from 'vitest';
import {
  parseEntityId,
  type MenuCategoryId,
  type ProductId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import {
  createClosedMenuLayoutEditorSession,
  menuLayoutEditorReducer,
  openMenuLayoutEditorSession,
  type MenuLayoutDraft,
} from './menuLayoutEditorSession';
import { moveProductWithinCategory } from './menuProductOrder';

const shopId = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const workerId = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const categoryId = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001');
const productA = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000001');
const productB = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000002');
const productC = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000003');

const persistedBase: MenuLayoutDraft = {
  categoryOrder: [categoryId],
  categoryAlignment: 'left',
  productOrder: [productB, productA, productC],
};

describe('menu layout stale drag fencing', () => {
  it('ignores a late product drag-over mutation after cancel and reopen', () => {
    let state = openMenuLayoutEditorSession(createClosedMenuLayoutEditorSession(), {
      shopId,
      workerId,
      base: persistedBase,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: [productA, productB, productC],
    });
    state = menuLayoutEditorReducer(state, { type: 'CANCEL_EDITOR' });
    state = menuLayoutEditorReducer(state, {
      type: 'OPEN',
      shopId,
      workerId,
      base: persistedBase,
    });

    const afterLateDragOver = menuLayoutEditorReducer(state, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: [productA, productB, productC],
    });

    expect(afterLateDragOver.draft?.productOrder).toEqual(persistedBase.productOrder);
    expect(afterLateDragOver.dirty).toBe(false);
  });

  it('ignores a delayed reorder from the previous product after another pickup starts', () => {
    let state = openMenuLayoutEditorSession(createClosedMenuLayoutEditorSession(), {
      shopId,
      workerId,
      base: persistedBase,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productB,
      categoryId,
    });

    const afterStaleProductAReorder = menuLayoutEditorReducer(state, {
      type: 'SET_PRODUCT_ORDER',
      productId: productA,
      productOrder: [productA, productB, productC],
    } as never);

    expect(afterStaleProductAReorder.draft?.productOrder).toEqual(persistedBase.productOrder);
    expect(afterStaleProductAReorder.interaction).toMatchObject({
      type: 'PRODUCT_PICKUP',
      productId: productB,
    });
    expect(afterStaleProductAReorder.dirty).toBe(false);
  });

  it('ignores a delayed reorder from an older pickup generation of the same product', () => {
    let state = openMenuLayoutEditorSession(createClosedMenuLayoutEditorSession(), {
      shopId,
      workerId,
      base: persistedBase,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId,
    });
    if (state.draft === null) throw new Error('Expected an editable menu draft.');
    const staleProductAReorder = moveProductWithinCategory(
      state.draft.productOrder,
      state.draft.productOrder,
      productA,
      productC,
    );

    state = menuLayoutEditorReducer(state, { type: 'CANCEL_EDITOR' });
    state = menuLayoutEditorReducer(state, {
      type: 'OPEN',
      shopId,
      workerId,
      base: persistedBase,
    });
    state = menuLayoutEditorReducer(state, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId,
    });

    const afterStaleSameProductReorder = menuLayoutEditorReducer(state, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: staleProductAReorder,
    });

    expect(afterStaleSameProductReorder.draft?.productOrder).toEqual(persistedBase.productOrder);
    expect(afterStaleSameProductReorder.interaction).toMatchObject({
      type: 'PRODUCT_PICKUP',
      productId: productA,
    });
    expect(afterStaleSameProductReorder.dirty).toBe(false);
  });
});
