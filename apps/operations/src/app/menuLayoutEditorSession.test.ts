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
const workerA = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const workerB = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');
const categoryA = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000001');
const categoryB = parseEntityId<MenuCategoryId>('30000000-0000-4000-8000-000000000002');
const productA = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000001');
const productB = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000002');
const productC = parseEntityId<ProductId>('40000000-0000-4000-8000-000000000003');

const base: MenuLayoutDraft = {
  categoryOrder: [categoryA, categoryB],
  categoryAlignment: 'left',
  productOrder: [productA, productB, productC],
};

function opened() {
  return openMenuLayoutEditorSession(createClosedMenuLayoutEditorSession(), {
    shopId,
    workerId: workerA,
    base,
  });
}

describe('menuLayoutEditorSession', () => {
  it('rolls an undropped product move back before a category change', () => {
    const picked = menuLayoutEditorReducer(opened(), {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId: categoryA,
    });
    const moved = menuLayoutEditorReducer(picked, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: [productB, productA, productC],
    });
    const changed = menuLayoutEditorReducer(moved, { type: 'CATEGORY_CHANGE' });

    expect(changed.draft?.productOrder).toEqual(base.productOrder);
    expect(changed.interaction).toEqual({ type: 'NONE' });
    expect(changed.dirty).toBe(false);
  });

  it('rolls product pickup back before category pickup begins', () => {
    const pickedProduct = menuLayoutEditorReducer(opened(), {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId: categoryA,
    });
    const moved = menuLayoutEditorReducer(pickedProduct, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: [productB, productA, productC],
    });
    const pickedCategory = menuLayoutEditorReducer(moved, {
      type: 'BEGIN_CATEGORY_PICKUP',
      categoryId: categoryA,
    });

    expect(pickedCategory.draft?.productOrder).toEqual(base.productOrder);
    expect(pickedCategory.interaction.type).toBe('CATEGORY_PICKUP');
  });

  it('rolls category pickup back before product pickup begins', () => {
    const pickedCategory = menuLayoutEditorReducer(opened(), {
      type: 'BEGIN_CATEGORY_PICKUP',
      categoryId: categoryA,
    });
    const moved = menuLayoutEditorReducer(pickedCategory, {
      type: 'SET_CATEGORY_ORDER',
      categoryOrder: [categoryB, categoryA],
    });
    const pickedProduct = menuLayoutEditorReducer(moved, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId: categoryA,
    });

    expect(pickedProduct.draft?.categoryOrder).toEqual(base.categoryOrder);
    expect(pickedProduct.interaction.type).toBe('PRODUCT_PICKUP');
  });

  it('rolls the pickup snapshot back on Escape cancellation', () => {
    const picked = menuLayoutEditorReducer(opened(), {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId: categoryA,
    });
    const moved = menuLayoutEditorReducer(picked, {
      type: 'SET_PRODUCT_ORDER',
      productOrder: [productB, productA, productC],
    });

    const cancelled = menuLayoutEditorReducer(moved, { type: 'CANCEL_PICKUP' });
    expect(cancelled.draft).toEqual(base);
    expect(cancelled.interaction).toEqual({ type: 'NONE' });
  });

  it('resets the entire draft and clears a pickup', () => {
    const changed = menuLayoutEditorReducer(opened(), {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'right',
    });
    const picked = menuLayoutEditorReducer(changed, {
      type: 'BEGIN_PRODUCT_PICKUP',
      productId: productA,
      categoryId: categoryA,
    });
    const resetDraft: MenuLayoutDraft = {
      categoryOrder: [categoryA, categoryB],
      categoryAlignment: 'left',
      productOrder: [productA, productB, productC],
    };

    const reset = menuLayoutEditorReducer(picked, { type: 'RESET', draft: resetDraft });
    expect(reset.draft).toEqual(resetDraft);
    expect(reset.interaction).toEqual({ type: 'NONE' });
    expect(reset.resetRequested).toBe(true);
  });

  it('cancel closes a dirty edit instead of leaking its draft', () => {
    const changed = menuLayoutEditorReducer(opened(), {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'right',
    });
    expect(changed.dirty).toBe(true);

    const cancelled = menuLayoutEditorReducer(changed, { type: 'CANCEL_EDITOR' });
    expect(cancelled).toEqual(createClosedMenuLayoutEditorSession());
  });

  it('worker identity invalidation closes the old transaction', () => {
    const invalidated = menuLayoutEditorReducer(opened(), {
      type: 'IDENTITY_INVALIDATED',
      shopId,
      workerId: workerB,
    });
    expect(invalidated).toEqual(createClosedMenuLayoutEditorSession());
  });

  it('ignores a stale save completion for a different worker', () => {
    const dirty = menuLayoutEditorReducer(opened(), {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'center',
    });
    const saving = menuLayoutEditorReducer(dirty, {
      type: 'BEGIN_SAVE',
      saveToken: 'save-a',
    });

    const stale = menuLayoutEditorReducer(saving, {
      type: 'SAVE_SUCCESS',
      shopId,
      workerId: workerB,
      saveToken: 'save-a',
    });
    expect(stale).toEqual(saving);
  });

  it('recomputes dirty state from base versus draft', () => {
    const changed = menuLayoutEditorReducer(opened(), {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'center',
    });
    expect(changed.dirty).toBe(true);

    const restored = menuLayoutEditorReducer(changed, {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'left',
    });
    expect(restored.dirty).toBe(false);
  });

  it('freezes persisted-layout mutations while saving', () => {
    const dirty = menuLayoutEditorReducer(opened(), {
      type: 'SET_ALIGNMENT',
      categoryAlignment: 'center',
    });
    const saving = menuLayoutEditorReducer(dirty, {
      type: 'BEGIN_SAVE',
      saveToken: 'save-a',
    });

    const mutated = menuLayoutEditorReducer(saving, {
      type: 'SET_CATEGORY_ORDER',
      categoryOrder: [categoryB, categoryA],
    });
    const reset = menuLayoutEditorReducer(saving, { type: 'RESET', draft: base });
    const cancelled = menuLayoutEditorReducer(saving, { type: 'CANCEL_EDITOR' });

    expect(mutated).toEqual(saving);
    expect(reset).toEqual(saving);
    expect(cancelled).toEqual(saving);
  });
});
