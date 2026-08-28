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

if 'function moveCategoryByOffset' not in source:
    category_offset = '''  function moveCategoryByOffset(categoryId: MenuCategoryId, offset: -1 | 1): void {
    setMenuEditResetRequested(false);
    setCategoryEditOrder((current) => {
      const sourceIndex = current.indexOf(categoryId);
      const targetIndex = sourceIndex + offset;
      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [next[targetIndex]!, next[sourceIndex]!];
      return next;
    });
  }

'''
    source = source.replace(
        '  function moveDraggedCategory(targetId: MenuCategoryId): void {\n',
        category_offset + '  function moveDraggedCategory(targetId: MenuCategoryId): void {\n',
        1,
    )

if 'function moveProductByOffset' not in source:
    product_offset = '''  function moveProductByOffset(productId: ProductId, offset: -1 | 1): void {
    if (selectedCategoryId === null) return;
    setMenuEditResetRequested(false);
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (candidateId) => productCategoryById.get(candidateId) === selectedCategoryId,
      );
      return moveProductWithinCategoryByOffset(current, categoryProductIds, productId, offset);
    });
  }

'''
    source = source.replace(
        '  function moveDraggedProduct(targetId: ProductId): void {\n',
        product_offset + '  function moveDraggedProduct(targetId: ProductId): void {\n',
        1,
    )

category_key_anchor = '''                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedCategoryId(null);
                        }}
                        onClick={() => {
'''
if 'moveCategoryByOffset(category.id, -1)' not in source:
    category_key_block = '''                        onDrop={(event) => {
                          event.preventDefault();
                          setDraggedCategoryId(null);
                        }}
                        onKeyDown={(event) => {
                          if (!menuEditActive) return;
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

product_key_anchor = '''                    onDrop={(event) => {
                      event.preventDefault();
                      setDraggedProductId(null);
                    }}
                  >
'''
if 'moveProductByOffset(product.id, -1)' not in source:
    product_key_block = '''                    onDrop={(event) => {
                      event.preventDefault();
                      setDraggedProductId(null);
                    }}
                    onKeyDown={(event) => {
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

if 'moveProductWithinCategoryByOffset' not in source or 'function moveCategoryByOffset' not in source:
    raise SystemExit('Task 6 keyboard reorder code was not installed')
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
.menu-edit-product-card-dragging {
  border-color: color-mix(in srgb, var(--tux-accent) 58%, var(--tux-border-subtle));
  background: color-mix(in srgb, var(--tux-accent-soft) 28%, var(--tux-surface-panel));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--tux-text-primary) 11%, transparent);
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
}
'''

if '@keyframes menu-edit-jiggle' not in styles or 'animation: none' not in styles:
    raise SystemExit('Task 6 edit-mode motion styles were not installed')
styles_path.write_text(styles)
