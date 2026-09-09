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
});
