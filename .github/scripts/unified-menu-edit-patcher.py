import re
from pathlib import Path

workspace_path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
source = workspace_path.read_text()

if 'moveProductWithinCategoryByOffset' not in source:
    source = source.replace(
        '  moveProductWithinCategory,\n  reconcileProductOrder,\n',
        '  moveProductWithinCategory,\n  moveProductWithinCategoryByOffset,\n  reconcileProductOrder,\n',
        1,
    )

ref_anchor = "  const cartResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);\n"
if 'categoryPickupSnapshotRef' not in source:
    if ref_anchor not in source:
        raise SystemExit('Could not locate menu edit snapshot ref anchor')
    source = source.replace(
        ref_anchor,
        ref_anchor
        + '  const categoryPickupSnapshotRef = useRef<readonly MenuCategoryId[] | null>(null);\n'
        + '  const productPickupSnapshotRef = useRef<readonly ProductId[] | null>(null);\n',
        1,
    )

state_anchor = '  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);\n'
if 'grabbedCategoryId' not in source:
    if state_anchor not in source:
        raise SystemExit('Could not locate menu edit pickup state anchor')
    source = source.replace(
        state_anchor,
        state_anchor
        + '  const [grabbedCategoryId, setGrabbedCategoryId] = useState<MenuCategoryId | null>(null);\n'
        + '  const [grabbedProductId, setGrabbedProductId] = useState<ProductId | null>(null);\n'
        + "  const [menuEditAnnouncement, setMenuEditAnnouncement] = useState('');\n",
        1,
    )

begin_old = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditActive(true);
'''
begin_new = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setGrabbedCategoryId(null);
    setGrabbedProductId(null);
    categoryPickupSnapshotRef.current = null;
    productPickupSnapshotRef.current = null;
    setMenuEditAnnouncement(
      'Menu edit mode. Pick up a category or product with Enter or Space, move it with arrow keys, and press Escape to cancel a pickup.',
    );
    setMenuEditActive(true);
'''
if begin_old in source:
    source = source.replace(begin_old, begin_new, 1)

reset_old = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditError(null);
    setMenuEditResetRequested(true);
'''
reset_new = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setGrabbedCategoryId(null);
    setGrabbedProductId(null);
    categoryPickupSnapshotRef.current = null;
    productPickupSnapshotRef.current = null;
    setMenuEditAnnouncement('Menu layout reset to defaults. Save to keep the reset.');
    setMenuEditError(null);
    setMenuEditResetRequested(true);
'''
if reset_old in source:
    source = source.replace(reset_old, reset_new, 1)

cancel_old = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditError(null);
    setMenuEditResetRequested(false);
  }

  async function saveMenuEdit'''
cancel_new = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setGrabbedCategoryId(null);
    setGrabbedProductId(null);
    categoryPickupSnapshotRef.current = null;
    productPickupSnapshotRef.current = null;
    setMenuEditAnnouncement('');
    setMenuEditError(null);
    setMenuEditResetRequested(false);
  }

  async function saveMenuEdit'''
if cancel_old in source:
    source = source.replace(cancel_old, cancel_new, 1)

save_old = '''      setDraggedCategoryId(null);
      setDraggedProductId(null);
      setSuccessMessage('Menu layout saved');
'''
save_new = '''      setDraggedCategoryId(null);
      setDraggedProductId(null);
      setGrabbedCategoryId(null);
      setGrabbedProductId(null);
      categoryPickupSnapshotRef.current = null;
      productPickupSnapshotRef.current = null;
      setMenuEditAnnouncement('');
      setSuccessMessage('Menu layout saved');
'''
if save_old in source:
    source = source.replace(save_old, save_new, 1)

if 'function moveCategoryByOffset' not in source:
    helpers = '''  function moveCategoryByOffset(categoryId: MenuCategoryId, offset: -1 | 1): void {
    setMenuEditResetRequested(false);
    setCategoryEditOrder((current) => {
      const sourceIndex = current.indexOf(categoryId);
      const targetIndex = sourceIndex + offset;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex]!, next[sourceIndex]!];
      const category = configuredActiveCategories.find((candidate) => candidate.id === categoryId);
      setMenuEditAnnouncement(
        `${category?.name ?? 'Category'} moved to position ${targetIndex + 1} of ${next.length}.`,
      );
      return next;
    });
  }

  function toggleCategoryPickup(categoryId: MenuCategoryId): void {
    const category = configuredActiveCategories.find((candidate) => candidate.id === categoryId);
    if (grabbedCategoryId === categoryId) {
      setGrabbedCategoryId(null);
      categoryPickupSnapshotRef.current = null;
      setMenuEditAnnouncement(`${category?.name ?? 'Category'} dropped.`);
      return;
    }
    categoryPickupSnapshotRef.current = categoryEditOrder;
    setGrabbedProductId(null);
    productPickupSnapshotRef.current = null;
    setGrabbedCategoryId(categoryId);
    setMenuEditAnnouncement(
      `${category?.name ?? 'Category'} picked up. Use Left or Right Arrow to move, Enter or Space to drop, or Escape to cancel.`,
    );
  }

  function cancelCategoryPickup(): void {
    if (grabbedCategoryId === null) return;
    const category = configuredActiveCategories.find(
      (candidate) => candidate.id === grabbedCategoryId,
    );
    const snapshot = categoryPickupSnapshotRef.current;
    if (snapshot !== null) setCategoryEditOrder(snapshot);
    setGrabbedCategoryId(null);
    categoryPickupSnapshotRef.current = null;
    setMenuEditAnnouncement(`${category?.name ?? 'Category'} movement cancelled.`);
  }

  function moveProductByOffset(productId: ProductId, offset: -1 | 1): void {
    if (selectedCategoryId === null) return;
    setMenuEditResetRequested(false);
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (candidateId) => productCategoryById.get(candidateId) === selectedCategoryId,
      );
      const next = moveProductWithinCategoryByOffset(
        current,
        categoryProductIds,
        productId,
        offset,
      );
      if (next !== current) {
        const categoryOnly = next.filter(
          (candidateId) => productCategoryById.get(candidateId) === selectedCategoryId,
        );
        const product = configuration?.products.find((candidate) => candidate.id === productId);
        setMenuEditAnnouncement(
          `${product?.name ?? 'Product'} moved to position ${categoryOnly.indexOf(productId) + 1} of ${categoryOnly.length}.`,
        );
      }
      return next;
    });
  }

  function toggleProductPickup(productId: ProductId): void {
    const product = configuration?.products.find((candidate) => candidate.id === productId);
    if (grabbedProductId === productId) {
      setGrabbedProductId(null);
      productPickupSnapshotRef.current = null;
      setMenuEditAnnouncement(`${product?.name ?? 'Product'} dropped.`);
      return;
    }
    productPickupSnapshotRef.current = menuEditProductOrder;
    setGrabbedCategoryId(null);
    categoryPickupSnapshotRef.current = null;
    setGrabbedProductId(productId);
    setMenuEditAnnouncement(
      `${product?.name ?? 'Product'} picked up. Use arrow keys to move, Enter or Space to drop, or Escape to cancel.`,
    );
  }

  function cancelProductPickup(): void {
    if (grabbedProductId === null) return;
    const product = configuration?.products.find((candidate) => candidate.id === grabbedProductId);
    const snapshot = productPickupSnapshotRef.current;
    if (snapshot !== null) setMenuEditProductOrder(snapshot);
    setGrabbedProductId(null);
    productPickupSnapshotRef.current = null;
    setMenuEditAnnouncement(`${product?.name ?? 'Product'} movement cancelled.`);
  }

'''
    marker = '  function moveDraggedCategory(targetId: MenuCategoryId): void {\n'
    if marker not in source:
        raise SystemExit('Could not locate category reorder helper anchor')
    source = source.replace(marker, helpers + marker, 1)

category_drag_class = "                          draggedCategoryId === category.id ? 'category-tab-dragging' : '',\n"
if 'category-tab-grabbed' not in source:
    if category_drag_class not in source:
        raise SystemExit('Could not locate category grabbed class anchor')
    source = source.replace(
        category_drag_class,
        category_drag_class
        + "                          grabbedCategoryId === category.id ? 'category-tab-grabbed' : '',\n",
        1,
    )

category_key_anchor = '''                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedCategoryId(null);
                        }}
                        onClick={() => {
'''
if 'toggleCategoryPickup(category.id)' not in source:
    category_key_block = '''                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedCategoryId(null);
                        }}
                        onKeyDown={(event) => {
                          if (!menuEditActive || menuEditSaving) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            toggleCategoryPickup(category.id);
                            return;
                          }
                          if (event.key === 'Escape' && grabbedCategoryId === category.id) {
                            event.preventDefault();
                            cancelCategoryPickup();
                            return;
                          }
                          if (grabbedCategoryId !== category.id) return;
                          if (event.key === 'ArrowLeft') {
                            event.preventDefault();
                            moveCategoryByOffset(category.id, -1);
                          } else if (event.key === 'ArrowRight') {
                            event.preventDefault();
                            moveCategoryByOffset(category.id, 1);
                          }
                        }}
                        onClick={() => {
'''
    if category_key_anchor not in source:
        raise SystemExit('Could not locate category keyboard insertion point')
    source = source.replace(category_key_anchor, category_key_block, 1)

product_drag_class = "                      draggedProductId === product.id ? 'menu-edit-product-card-dragging' : '',\n"
if 'menu-edit-product-card-grabbed' not in source:
    if product_drag_class not in source:
        raise SystemExit('Could not locate Product Card grabbed class anchor')
    source = source.replace(
        product_drag_class,
        product_drag_class
        + "                      grabbedProductId === product.id ? 'menu-edit-product-card-grabbed' : '',\n",
        1,
    )

product_key_anchor = '''                    onDrop={(event) => {
                      event.preventDefault();
                      setDraggedProductId(null);
                    }}
                  >
'''
if 'toggleProductPickup(product.id)' not in source:
    product_key_block = '''                    onDrop={(event) => {
                      event.preventDefault();
                      setDraggedProductId(null);
                    }}
                    onKeyDown={(event) => {
                      if (menuEditSaving) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleProductPickup(product.id);
                        return;
                      }
                      if (event.key === 'Escape' && grabbedProductId === product.id) {
                        event.preventDefault();
                        cancelProductPickup();
                        return;
                      }
                      if (grabbedProductId !== product.id) return;
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        moveProductByOffset(product.id, -1);
                      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        moveProductByOffset(product.id, 1);
                      }
                    }}
                  >
'''
    if product_key_anchor not in source:
        raise SystemExit('Could not locate Product Card keyboard insertion point')
    source = source.replace(product_key_anchor, product_key_block, 1)

if 'aria-live="polite" aria-atomic="true"' not in source:
    action_marker = '''          {menuEditActive ? (
            <div className="menu-edit-actions" aria-label="Menu edit actions">
'''
    live_region = '''          {menuEditActive ? (
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {menuEditAnnouncement}
            </div>
          ) : null}

'''
    if action_marker not in source:
        raise SystemExit('Could not locate menu edit action bar for live region')
    source = source.replace(action_marker, live_region + action_marker, 1)

required_source = [
    'grabbedCategoryId',
    'grabbedProductId',
    'categoryPickupSnapshotRef',
    'productPickupSnapshotRef',
    'function toggleCategoryPickup',
    'function cancelCategoryPickup',
    'function toggleProductPickup',
    'function cancelProductPickup',
    'category-tab-grabbed',
    'menu-edit-product-card-grabbed',
    'aria-live="polite" aria-atomic="true"',
]
for needle in required_source:
    if needle not in source:
        raise SystemExit(f'Task 6 pickup behavior missing: {needle}')
workspace_path.write_text(source)

styles_path = Path('apps/operations/src/styles/final-pos-corrections.css')
styles = styles_path.read_text()
styles = re.sub(
    r"\n/\* Approved worker-specific Product Card position editor\. \*/\n\.category-manage-order-action \{[\s\S]*?\n\}\n\n\.category-manage-order-action:hover:not\(:disabled\) \{[\s\S]*?\n\}\n",
    '\n/* Legacy ProductPositionEditor styles remain for its isolated component tests. */\n',
    styles,
    count=1,
)
styles = re.sub(
    r"\n  \.menu-toolbar \.category-nav-actions > \.category-manage-order-action \{[\s\S]*?\n  \}\n",
    '\n',
    styles,
    count=1,
)

if '@keyframes menu-edit-jiggle' not in styles:
    styles += '''

/* Unified Menu Edit Mode: one in-place worker-specific reorder surface. */
.menu-edit-actions {
  position: sticky;
  z-index: 2;
  bottom: 0;
  display: flex;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: var(--tux-space-3);
  padding: 8px var(--tux-space-4) max(8px, env(safe-area-inset-bottom));
  border-top: 1px solid var(--tux-border-subtle);
  background: color-mix(in srgb, var(--tux-surface-panel) 94%, transparent);
  box-shadow: 0 -10px 24px color-mix(in srgb, var(--tux-text-primary) 5%, transparent);
  backdrop-filter: blur(14px) saturate(112%);
  -webkit-backdrop-filter: blur(14px) saturate(112%);
}

.menu-edit-action-status,
.menu-edit-actions-primary {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-edit-actions button {
  min-height: 44px;
}

.menu-edit-actions > .menu-edit-action-status > .text-action {
  min-height: 44px;
  border: 0;
  border-radius: var(--tux-radius-sm);
  background: transparent;
  color: var(--tux-text-secondary);
  padding: 0 12px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}

.category-tab-reordering,
.menu-edit-product-card {
  cursor: grab;
  user-select: none;
  touch-action: manipulation;
  transform-origin: center;
}

.category-tab-dragging,
.category-tab-grabbed,
.menu-edit-product-card-dragging,
.menu-edit-product-card-grabbed {
  animation-play-state: paused;
  border-color: color-mix(in srgb, var(--tux-accent) 58%, var(--tux-border-subtle));
  background: color-mix(in srgb, var(--tux-accent-soft) 28%, var(--tux-surface-panel));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--tux-text-primary) 11%, transparent);
  transform: translateY(-2px) scale(1.01);
}

.menu-edit-product-hint {
  padding: 0 8px 8px;
  color: var(--tux-text-secondary);
  font-size: 12px;
  line-height: 16px;
  font-weight: 600;
}

@keyframes menu-edit-jiggle {
  0%,
  100% {
    transform: rotate(-0.2deg) translateY(0);
  }
  50% {
    transform: rotate(0.2deg) translateY(-0.5px);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .category-tab-reordering {
    animation: menu-edit-jiggle 1.8s ease-in-out infinite;
  }

  .menu-edit-product-card {
    animation: menu-edit-jiggle 1.95s ease-in-out infinite;
  }

  .category-tab-reordering:nth-child(2n),
  .menu-edit-product-card:nth-child(2n) {
    animation-delay: -0.45s;
  }

  .category-tab-reordering:nth-child(3n),
  .menu-edit-product-card:nth-child(3n) {
    animation-delay: -0.9s;
  }
}

@media (max-width: 54rem) {
  .menu-edit-actions {
    padding-inline: 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .category-tab-reordering,
  .menu-edit-product-card {
    animation: none;
    transform: none;
  }

  .category-tab-dragging,
  .category-tab-grabbed,
  .menu-edit-product-card-dragging,
  .menu-edit-product-card-grabbed {
    transform: none;
  }
}
'''

for needle in [
    '@keyframes menu-edit-jiggle',
    '.category-tab-grabbed',
    '.menu-edit-product-card-grabbed',
    'animation: none',
]:
    if needle not in styles:
        raise SystemExit(f'Task 6 edit-mode style missing: {needle}')
styles_path.write_text(styles)
