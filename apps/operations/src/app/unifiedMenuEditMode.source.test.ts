import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersWorkspaceSource = readFileSync(
  new URL('./OrdersWorkspace.tsx', import.meta.url),
  'utf8',
);
const menuLayoutEditorSessionSource = readFileSync(
  new URL('./menuLayoutEditorSession.ts', import.meta.url),
  'utf8',
);
const menuEditProductCardSource = readFileSync(
  new URL('./MenuEditProductCard.tsx', import.meta.url),
  'utf8',
);
const menuEditStyles = readFileSync(
  new URL('../styles/final-pos-corrections.css', import.meta.url),
  'utf8',
);

// Unified edit evidence uses the same single-session contract exercised here.
describe('unified menu edit entry point', () => {
  it('removes the standalone Manage order entry point while retaining the existing edit/search controls', () => {
    expect(ordersWorkspaceSource).not.toContain('Manage order');
    expect(ordersWorkspaceSource).not.toContain('category-manage-order-action');
    expect(ordersWorkspaceSource).toContain('EditPencilIcon');
    expect(ordersWorkspaceSource).toContain('SearchIcon');
  });

  // Edit mode consumes app-search shortcuts instead of handing them to the browser.
  it('uses Pencil to activate one reducer-owned menu edit session and suppresses search shortcuts during it', () => {
    expect(ordersWorkspaceSource).toContain('menuEditActive');
    expect(ordersWorkspaceSource).toContain('dispatchMenuLayoutEditor({');
    expect(ordersWorkspaceSource).toContain("type: 'OPEN'");
    expect(ordersWorkspaceSource).toContain('aria-pressed={menuEditActive}');
    expect(ordersWorkspaceSource).toMatch(
      /if \(\(event\.ctrlKey \|\| event\.metaKey\) && event\.key\.toLowerCase\(\) === 'k'\) \{\s*event\.preventDefault\(\);\s*if \(menuEditActive\) return;/,
    );
    expect(ordersWorkspaceSource).toMatch(
      /if \(event\.key === '\/' && !targetIsEditor\) \{\s*event\.preventDefault\(\);\s*if \(menuEditActive\) return;/,
    );
    expect(ordersWorkspaceSource).not.toContain("categoryMode === 'EDIT'");
  });

  it('uses dnd-kit sensors, sortable contexts, stock spatial keyboard coordinates, and an overlay', () => {
    expect(ordersWorkspaceSource).toContain('DndContext');
    expect(ordersWorkspaceSource).toContain('PointerSensor');
    expect(ordersWorkspaceSource).toContain('TouchSensor');
    expect(ordersWorkspaceSource).toContain('KeyboardSensor');
    expect(ordersWorkspaceSource).toContain('useSensor');
    expect(ordersWorkspaceSource).toContain('useSensors');
    expect(ordersWorkspaceSource).toContain('DragOverlay');
    expect(ordersWorkspaceSource).toContain('SortableContext');
    expect(ordersWorkspaceSource).toContain('sortableKeyboardCoordinates');
    expect(ordersWorkspaceSource).toContain('horizontalListSortingStrategy');
    expect(ordersWorkspaceSource).toContain('rectSortingStrategy');
  });

  it('keeps category tabs in the header and makes those same tabs sortable in edit mode', () => {
    expect(ordersWorkspaceSource).not.toContain('<strong>Category layout</strong>');
    expect(ordersWorkspaceSource).not.toContain('className="category-editor"');
    expect(ordersWorkspaceSource).toContain('category-tab-reordering');
    expect(ordersWorkspaceSource).toContain('categorySortableIds');
    expect(ordersWorkspaceSource).toContain(
      'data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}',
    );
  });

  it('keeps Product Cards in the menu grid and gives the edit wrapper sortable semantics only', () => {
    expect(ordersWorkspaceSource).not.toContain('<ProductPositionEditor');
    expect(ordersWorkspaceSource).not.toContain('productReorderCategoryId');
    expect(ordersWorkspaceSource).toContain('menuEditProductOrder');
    expect(ordersWorkspaceSource).toContain('menu-edit-product-card');
    expect(menuEditProductCardSource).toContain('useSortable');
    expect(menuEditProductCardSource).not.toContain('Quick Info');
    expect(menuEditProductCardSource).not.toContain('onExtras');
    expect(menuEditProductCardSource).not.toContain('onAdd');
    expect(menuEditProductCardSource).not.toContain('onDecrement');
  });

  it('removes native HTML5 menu sorting while allowing reducer-owned dnd-kit drag-over updates', () => {
    expect(ordersWorkspaceSource).not.toContain('draggable={');
    expect(ordersWorkspaceSource).not.toContain('draggable:');
    expect(ordersWorkspaceSource).not.toContain('dataTransfer');
    expect(ordersWorkspaceSource).not.toContain('onDragEnter');
    expect(ordersWorkspaceSource).not.toContain('onDrop');
    expect(ordersWorkspaceSource).toContain('onDragStart={handleMenuEditDragStart}');
    expect(ordersWorkspaceSource).toContain('onDragOver={handleMenuEditDragOver}');
    expect(ordersWorkspaceSource).toContain('onDragEnd={handleMenuEditDragEnd}');
  });

  it('persists category and product layout together through the menu-layout-only API', () => {
    expect(ordersWorkspaceSource).toContain('menuEditPreferenceInput');
    expect(ordersWorkspaceSource).toContain('function saveMenuEdit');
    expect(ordersWorkspaceSource).toContain('function resetMenuEdit');
    expect(ordersWorkspaceSource).toContain('function cancelMenuEdit');
    expect(ordersWorkspaceSource).toContain('aria-label="Menu edit actions"');
    expect(ordersWorkspaceSource).toContain('onClick={resetMenuEdit}');
    expect(ordersWorkspaceSource).toContain('onClick={cancelMenuEdit}');
    expect(ordersWorkspaceSource).toContain("'Saving…' : 'Save'");
    expect(ordersWorkspaceSource.match(/preferencesClient\.updateMenuLayout\(/g)).toHaveLength(1);
    expect(ordersWorkspaceSource).not.toContain('preferencesClient.update(');
  });

  // Saving freezes every persisted menu-layout control after the payload is captured.
  it('freezes every edit interaction while the final preference save is in flight', () => {
    expect(
      ordersWorkspaceSource.match(/disabled=\{menuEditSaving\}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(ordersWorkspaceSource).toContain(
      "const menuEditSaving = menuEditSession.lifecycle === 'SAVING';",
    );
    expect(menuLayoutEditorSessionSource).toContain(
      "if (state.lifecycle === 'SAVING') return state;",
    );
    expect(
      ordersWorkspaceSource.match(/if \(menuEditSaving\) return;/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(4);
  });

  it('uses dnd-kit spatial keyboard sorting for categories and Product Cards', () => {
    expect(ordersWorkspaceSource).toContain('KeyboardSensor');
    expect(ordersWorkspaceSource).toContain('coordinateGetter: sortableKeyboardCoordinates');
    expect(ordersWorkspaceSource).toContain('menuEditAnnouncement');
    expect(ordersWorkspaceSource).toContain('aria-live="polite" aria-atomic="true"');
  });

  it('jiggles both reorder surfaces continuously with staggered timing and distinct active state while respecting Reduced Motion', () => {
    expect(menuEditStyles).toContain('@keyframes menu-edit-jiggle');
    expect(menuEditStyles).toContain('.category-tab-reordering');
    expect(menuEditStyles).toContain('.menu-edit-product-card');
    expect(menuEditStyles).toContain('animation: menu-edit-jiggle');
    expect(menuEditStyles).toContain(':nth-child(2n)');
    expect(menuEditStyles).toContain(':nth-child(3n)');
    expect(menuEditStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(menuEditStyles).toContain('animation: none');
  });
});
