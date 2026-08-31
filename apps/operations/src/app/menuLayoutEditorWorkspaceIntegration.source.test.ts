import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersWorkspaceSource = readFileSync(
  new URL('./OrdersWorkspace.tsx', import.meta.url),
  'utf8',
);

describe('OrdersWorkspace menu-layout transaction integration', () => {
  it('uses one menuLayoutEditorReducer session as the editor transaction authority', () => {
    expect(ordersWorkspaceSource).toContain('menuLayoutEditorReducer');
    expect(ordersWorkspaceSource).toContain('createClosedMenuLayoutEditorSession');
    expect(ordersWorkspaceSource).toContain('dispatchMenuLayoutEditor');
    expect(ordersWorkspaceSource).toContain("menuEditSession.lifecycle === 'SAVING'");
    expect(ordersWorkspaceSource).toContain('menuEditSession.draft');
    expect(ordersWorkspaceSource).toContain('menuEditSession.saveError');

    expect(ordersWorkspaceSource).not.toContain('setMenuEditActive');
    expect(ordersWorkspaceSource).not.toContain('setCategoryEditOrder');
    expect(ordersWorkspaceSource).not.toContain('setCategoryEditAlignment');
    expect(ordersWorkspaceSource).not.toContain('setMenuEditProductOrder');
    expect(ordersWorkspaceSource).not.toContain('setMenuEditSaving');
    expect(ordersWorkspaceSource).not.toContain('setMenuEditError');
    expect(ordersWorkspaceSource).not.toContain('setMenuEditResetRequested');
  });

  it('routes category changes and dnd pickup lifecycle through reducer rollback semantics', () => {
    expect(ordersWorkspaceSource).toContain("type: 'CATEGORY_CHANGE'");
    expect(ordersWorkspaceSource).toContain("type: 'BEGIN_CATEGORY_PICKUP'");
    expect(ordersWorkspaceSource).toContain("type: 'BEGIN_PRODUCT_PICKUP'");
    expect(ordersWorkspaceSource).toContain("type: 'DROP_CATEGORY_PICKUP'");
    expect(ordersWorkspaceSource).toContain("type: 'DROP_PRODUCT_PICKUP'");
    expect(ordersWorkspaceSource).toContain("type: 'CANCEL_PICKUP'");

    const selectCategoryStart = ordersWorkspaceSource.indexOf(
      'function selectMenuEditCategory(categoryId: MenuCategoryId): void',
    );
    const selectCategoryEnd = ordersWorkspaceSource.indexOf(
      '\n  function resetMenuEdit',
      selectCategoryStart,
    );
    expect(selectCategoryStart).toBeGreaterThanOrEqual(0);
    expect(selectCategoryEnd).toBeGreaterThan(selectCategoryStart);

    const selectCategorySource = ordersWorkspaceSource.slice(
      selectCategoryStart,
      selectCategoryEnd,
    );
    const rollbackIndex = selectCategorySource.indexOf(
      "dispatchMenuLayoutEditor({ type: 'CATEGORY_CHANGE' });",
    );
    const selectionIndex = selectCategorySource.indexOf('setSelectedCategoryId(categoryId);');
    expect(rollbackIndex).toBeGreaterThanOrEqual(0);
    expect(selectionIndex).toBeGreaterThan(rollbackIndex);
  });

  it('routes Reset and Cancel through whole-draft reducer events', () => {
    expect(ordersWorkspaceSource).toContain("type: 'RESET'");
    expect(ordersWorkspaceSource).toContain("type: 'CANCEL_EDITOR'");
    expect(ordersWorkspaceSource).toContain('menuEditSession.resetRequested');
  });

  it('uses save identity plus a unique token and reducer completion events', () => {
    expect(ordersWorkspaceSource).toContain("type: 'BEGIN_SAVE'");
    expect(ordersWorkspaceSource).toContain("type: 'SAVE_SUCCESS'");
    expect(ordersWorkspaceSource).toContain("type: 'SAVE_FAILURE'");
    expect(ordersWorkspaceSource).toContain("type: 'IDENTITY_INVALIDATED'");
    expect(ordersWorkspaceSource).toContain('const saveToken = crypto.randomUUID()');
    expect(ordersWorkspaceSource).toContain('openingShopId');
    expect(ordersWorkspaceSource).toContain('openingWorkerId');
  });

  it('freezes alignment Reset Cancel and dnd mutation from the reducer SAVING lifecycle', () => {
    expect(ordersWorkspaceSource).toContain(
      "const menuEditSaving = menuEditSession.lifecycle === 'SAVING'",
    );
    expect(
      ordersWorkspaceSource.match(/if \(menuEditSaving\) return;/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
    expect(ordersWorkspaceSource).toContain('disabled={menuEditSaving}');
  });
});
