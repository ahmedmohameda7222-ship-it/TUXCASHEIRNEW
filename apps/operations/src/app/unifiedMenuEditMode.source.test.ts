import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersWorkspaceSource = readFileSync(
  new URL('./OrdersWorkspace.tsx', import.meta.url),
  'utf8',
);
const menuEditStyles = readFileSync(
  new URL('../styles/final-pos-corrections.css', import.meta.url),
  'utf8',
);

describe('unified menu edit entry point', () => {
  it('removes the standalone Manage order entry point while retaining the existing edit/search controls', () => {
    expect(ordersWorkspaceSource).not.toContain('Manage order');
    expect(ordersWorkspaceSource).not.toContain('category-manage-order-action');
    expect(ordersWorkspaceSource).toContain('EditPencilIcon');
    expect(ordersWorkspaceSource).toContain('SearchIcon');
  });

  it('uses Pencil to activate one pressed menu edit session and blocks Search during it', () => {
    expect(ordersWorkspaceSource).toContain('menuEditActive');
    expect(ordersWorkspaceSource).toContain('setMenuEditActive(true)');
    expect(ordersWorkspaceSource).toContain('aria-pressed={menuEditActive}');
    expect(ordersWorkspaceSource).toContain('if (menuEditActive) return;');
    expect(ordersWorkspaceSource).not.toContain("categoryMode === 'EDIT'");
  });

  it('keeps category tabs in the header and makes those same tabs reorderable in edit mode', () => {
    expect(ordersWorkspaceSource).not.toContain('<strong>Category layout</strong>');
    expect(ordersWorkspaceSource).not.toContain('className="category-editor"');
    expect(ordersWorkspaceSource).toContain('category-tab-reordering');
    expect(ordersWorkspaceSource).toContain('draggable={menuEditActive');
    expect(ordersWorkspaceSource).toContain(
      'data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}',
    );
  });

  it('keeps Product Cards in the menu grid and reorders them from the same unified draft', () => {
    expect(ordersWorkspaceSource).not.toContain('<ProductPositionEditor');
    expect(ordersWorkspaceSource).not.toContain('productReorderCategoryId');
    expect(ordersWorkspaceSource).toContain('menuEditProductOrder');
    expect(ordersWorkspaceSource).toContain('menu-edit-product-card');
    expect(ordersWorkspaceSource).toContain('moveProductWithinCategory');
  });

  it('persists category and product layout together through one Reset Cancel Save surface', () => {
    expect(ordersWorkspaceSource).toContain('menuEditPreferenceInput');
    expect(ordersWorkspaceSource).toContain('function saveMenuEdit');
    expect(ordersWorkspaceSource).toContain('function resetMenuEdit');
    expect(ordersWorkspaceSource).toContain('function cancelMenuEdit');
    expect(ordersWorkspaceSource).toContain('aria-label="Menu edit actions"');
    expect(ordersWorkspaceSource).toContain('onClick={resetMenuEdit}');
    expect(ordersWorkspaceSource).toContain('onClick={cancelMenuEdit}');
    expect(ordersWorkspaceSource).toContain("'Saving…' : 'Save'");
    expect(ordersWorkspaceSource.match(/preferencesClient\.update\(/g)).toHaveLength(1);
  });

  it('freezes every edit interaction while the final preference save is in flight', () => {
    expect(ordersWorkspaceSource).toMatch(
      /draggable=\{\s*menuEditActive\s*&&\s*!menuEditSaving\s*&&\s*draggedCategoryId\s*!==\s*category\.id\s*\}/,
    );
    expect(ordersWorkspaceSource).toMatch(
      /draggable=\{\s*menuEditActive\s*&&\s*!menuEditSaving\s*&&\s*draggedProductId\s*!==\s*product\.id\s*\}/,
    );
    expect(ordersWorkspaceSource).toContain('disabled={menuEditSaving}');
    expect(
      ordersWorkspaceSource.match(/if \(menuEditSaving\) return;/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
  });

  it('supports keyboard pickup drop move and cancel for categories and Product Cards', () => {
    expect(ordersWorkspaceSource).toContain('grabbedCategoryId');
    expect(ordersWorkspaceSource).toContain('grabbedProductId');
    expect(ordersWorkspaceSource).toContain('categoryPickupSnapshotRef');
    expect(ordersWorkspaceSource).toContain('productPickupSnapshotRef');
    expect(ordersWorkspaceSource).toContain('menuEditAnnouncement');
    expect(ordersWorkspaceSource).toContain('function toggleCategoryPickup');
    expect(ordersWorkspaceSource).toContain('function cancelCategoryPickup');
    expect(ordersWorkspaceSource).toContain('function toggleProductPickup');
    expect(ordersWorkspaceSource).toContain('function cancelProductPickup');
    expect(ordersWorkspaceSource).toContain('category-tab-grabbed');
    expect(ordersWorkspaceSource).toContain('menu-edit-product-card-grabbed');
    expect(ordersWorkspaceSource).toContain("event.key === 'Enter' || event.key === ' '");
    expect(ordersWorkspaceSource).toContain("event.key === 'Escape'");
    expect(ordersWorkspaceSource).toContain("event.key === 'ArrowLeft'");
    expect(ordersWorkspaceSource).toContain("event.key === 'ArrowRight'");
    expect(ordersWorkspaceSource).toContain("event.key === 'ArrowUp'");
    expect(ordersWorkspaceSource).toContain("event.key === 'ArrowDown'");
    expect(ordersWorkspaceSource).toContain('aria-live="polite" aria-atomic="true"');
  });

  it('jiggles both reorder surfaces continuously with staggered timing and distinct grabbed state while respecting Reduced Motion', () => {
    expect(menuEditStyles).toContain('@keyframes menu-edit-jiggle');
    expect(menuEditStyles).toContain('.category-tab-reordering');
    expect(menuEditStyles).toContain('.menu-edit-product-card');
    expect(menuEditStyles).toContain('animation: menu-edit-jiggle');
    expect(menuEditStyles).toContain(':nth-child(2n)');
    expect(menuEditStyles).toContain(':nth-child(3n)');
    expect(menuEditStyles).toContain('.category-tab-grabbed');
    expect(menuEditStyles).toContain('.menu-edit-product-card-grabbed');
    expect(menuEditStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(menuEditStyles).toContain('animation: none');
  });
});
