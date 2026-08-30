from pathlib import Path
import re

ORDERS = Path('apps/operations/src/app/OrdersWorkspace.tsx')
CSS_PATH = Path('apps/operations/src/styles/final-pos-corrections.css')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)


source = ORDERS.read_text()

source = replace_once(
    source,
    "import type {\n  OperationsSessionState,\n  OrdersWorkspace as OrdersWorkspaceData,\n} from '@tux/application';\n",
    "import {\n  DndContext,\n  DragOverlay,\n  KeyboardSensor,\n  PointerSensor,\n  TouchSensor,\n  closestCenter,\n  useSensor,\n  useSensors,\n  type DragEndEvent,\n  type DragStartEvent,\n} from '@dnd-kit/core';\nimport {\n  SortableContext,\n  horizontalListSortingStrategy,\n  rectSortingStrategy,\n  sortableKeyboardCoordinates,\n  useSortable,\n} from '@dnd-kit/sortable';\nimport { CSS } from '@dnd-kit/utilities';\nimport type {\n  OperationsSessionState,\n  OrdersWorkspace as OrdersWorkspaceData,\n} from '@tux/application';\n",
    'dnd imports',
)
source = replace_once(
    source,
    "import { MenuEditProductCard } from './MenuEditProductCard';\nimport { MenuProductCard } from './MenuProductCard';\n",
    "import {\n  MenuEditProductCard,\n  menuEditProductSortableId,\n} from './MenuEditProductCard';\nimport { MenuProductCard } from './MenuProductCard';\nimport { ProductCardPresentation } from './ProductCardPresentation';\n",
    'product card imports',
)
source = replace_once(
    source,
    "  moveProductWithinCategory,\n  moveProductWithinCategoryByOffset,\n  reconcileProductOrder,\n",
    "  moveProductWithinCategory,\n  reconcileProductOrder,\n",
    'manual product offset import',
)

category_helper = '''function menuEditCategorySortableId(categoryId: MenuCategoryId): string {
  return `category:${categoryId}`;
}

function MenuEditCategoryTab({
  category,
  selected,
  disabled,
  onSelect,
}: {
  readonly category: MenuCategory;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: menuEditCategorySortableId(category.id),
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      className={[
        'category-tab',
        selected ? 'selected' : '',
        'category-tab-reordering',
        isDragging ? 'category-tab-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {category.name}
    </button>
  );
}

'''
source = replace_once(
    source,
    'export function OrdersWorkspace({\n',
    category_helper + 'export function OrdersWorkspace({\n',
    'sortable category helper',
)

source = replace_once(
    source,
    "  const categoryPickupSnapshotRef = useRef<readonly MenuCategoryId[] | null>(null);\n  const productPickupSnapshotRef = useRef<readonly ProductId[] | null>(null);\n",
    '',
    'pickup refs',
)
source = replace_once(
    source,
    "  const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('left');\n  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);\n  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);\n  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);\n  const [grabbedCategoryId, setGrabbedCategoryId] = useState<MenuCategoryId | null>(null);\n  const [grabbedProductId, setGrabbedProductId] = useState<ProductId | null>(null);\n",
    "  const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('left');\n  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);\n  const [activeMenuDragId, setActiveMenuDragId] = useState<string | null>(null);\n",
    'drag state',
)
source = replace_once(
    source,
    '  );\n\n  const activeWorkerMenuPreferenceLoadState: WorkerMenuPreferenceLoadState =',
    '''  );
  const menuEditSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeWorkerMenuPreferenceLoadState: WorkerMenuPreferenceLoadState =''',
    'dnd sensors',
)

source = replace_once(
    source,
    '''  }, [configuration, menuEditProductOrder, selectedCategoryId]);

  const validation = useMemo(() => {
''',
    '''  }, [configuration, menuEditProductOrder, selectedCategoryId]);
  const categorySortableIds = useMemo(
    () => categoryEditorCategories.map((category) => menuEditCategorySortableId(category.id)),
    [categoryEditorCategories],
  );
  const productSortableIds = useMemo(
    () => menuEditProducts.map((product) => menuEditProductSortableId(product.id)),
    [menuEditProducts],
  );
  const activeDraggedCategory =
    activeMenuDragId === null
      ? null
      : (categoryEditorCategories.find(
          (category) => menuEditCategorySortableId(category.id) === activeMenuDragId,
        ) ?? null);
  const activeDraggedProduct =
    activeMenuDragId === null
      ? null
      : (menuEditProducts.find(
          (product) => menuEditProductSortableId(product.id) === activeMenuDragId,
        ) ?? null);

  const validation = useMemo(() => {
''',
    'sortable derivations',
)

clear_old_interaction = '''    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setGrabbedCategoryId(null);
    setGrabbedProductId(null);
    categoryPickupSnapshotRef.current = null;
    productPickupSnapshotRef.current = null;
'''
clear_count = source.count(clear_old_interaction)
if clear_count != 5:
    raise SystemExit(f'clear old interaction: expected 5 matches, found {clear_count}')
source = source.replace(clear_old_interaction, '    setActiveMenuDragId(null);\n')
source = replace_once(
    source,
    "      'Menu edit mode. Pick up a category or product with Enter or Space, move it with arrow keys, and press Escape to cancel a pickup.',",
    "      'Menu edit mode. Drag categories or products to reorder. Keyboard users can pick up an item with Space and move it with the arrow keys.',",
    'edit announcement',
)
source = replace_once(
    source,
    '  function resetMenuEdit(): void {\n',
    '  function resetMenuEdit(): void {\n    if (menuEditSaving) return;\n',
    'freeze reset',
)

handlers = '''
  function handleMenuEditDragStart(event: DragStartEvent): void {
    if (menuEditSaving) return;
    if (!menuEditActive) return;
    setActiveMenuDragId(String(event.active.id));
  }

  function handleMenuEditDragCancel(): void {
    if (menuEditSaving) return;
    setActiveMenuDragId(null);
  }

  function handleMenuEditDragEnd(event: DragEndEvent): void {
    const activeId = String(event.active.id);
    const overId = event.over === null ? null : String(event.over.id);
    setActiveMenuDragId(null);

    if (!menuEditActive || menuEditSaving) return;
    if (overId === null || activeId === overId) return;

    const activeCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === activeId,
    );
    const overCategory = categoryEditorCategories.find(
      (category) => menuEditCategorySortableId(category.id) === overId,
    );
    if (activeCategory !== undefined && overCategory !== undefined) {
      setMenuEditResetRequested(false);
      setCategoryEditOrder((current) => {
        const sourceIndex = current.indexOf(activeCategory.id);
        const targetIndex = current.indexOf(overCategory.id);
        if (sourceIndex < 0 || targetIndex < 0) return current;
        const next = [...current];
        const [moved] = next.splice(sourceIndex, 1);
        if (moved === undefined) return current;
        next.splice(targetIndex, 0, moved);
        setMenuEditAnnouncement(
          `${activeCategory.name} moved to position ${targetIndex + 1} of ${next.length}.`,
        );
        return next;
      });
      return;
    }

    const activeProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === activeId,
    );
    const overProduct = menuEditProducts.find(
      (product) => menuEditProductSortableId(product.id) === overId,
    );
    if (
      activeProduct === undefined ||
      overProduct === undefined ||
      selectedCategoryId === null ||
      activeProduct.categoryId !== selectedCategoryId ||
      overProduct.categoryId !== selectedCategoryId
    ) {
      return;
    }

    setMenuEditResetRequested(false);
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      const next = moveProductWithinCategory(
        current,
        categoryProductIds,
        activeProduct.id,
        overProduct.id,
      );
      if (next !== current) {
        const categoryOnly = next.filter(
          (productId) => productCategoryById.get(productId) === selectedCategoryId,
        );
        setMenuEditAnnouncement(
          `${activeProduct.name} moved to position ${categoryOnly.indexOf(activeProduct.id) + 1} of ${categoryOnly.length}.`,
        );
      }
      return next;
    });
  }
'''
source, count = re.subn(
    r'\n  function moveCategoryByOffset\([\s\S]*?(?=\n  function addProduct\()',
    handlers,
    source,
    count=1,
)
if count != 1:
    raise SystemExit(f'manual drag functions: expected 1 match, found {count}')

category_rail = '''                <div
                  className="category-rail"
                  aria-label="Menu categories"
                  data-alignment={menuEditActive ? categoryEditAlignment : categoryAlignment}
                >
                  {menuEditActive ? (
                    <SortableContext
                      items={categorySortableIds}
                      strategy={horizontalListSortingStrategy}
                    >
                      {categoryEditorCategories.map((category) => (
                        <MenuEditCategoryTab
                          key={category.id}
                          category={category}
                          selected={selectedCategoryId === category.id}
                          disabled={menuEditSaving}
                          onSelect={() => {
                            setSelectedCategoryId(category.id);
                            setSelectedFamily(null);
                            setSearch('');
                          }}
                        />
                      ))}
                    </SortableContext>
                  ) : (
                    activeCategories.map((category) => (
                      <button
                        type="button"
                        key={category.id}
                        className={[
                          'category-tab',
                          selectedCategoryId === category.id ? 'selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setSelectedCategoryId(category.id);
                          setSelectedFamily(null);
                          setSearch('');
                        }}
                      >
                        {category.name}
                      </button>
                    ))
                  )}
                </div>'''
source, count = re.subn(
    r'                <div\n                  className="category-rail"\n[\s\S]*?\n                </div>',
    category_rail,
    source,
    count=1,
)
if count != 1:
    raise SystemExit(f'category rail: expected 1 match, found {count}')

product_grid = '''          <div className="product-grid" aria-live="polite">
            {menuEditActive ? (
              menuEditProducts.length === 0 ? (
                <div className="menu-empty">
                  <strong>No products found</strong>
                  <span>This category has no active products.</span>
                </div>
              ) : (
                <SortableContext items={productSortableIds} strategy={rectSortingStrategy}>
                  {menuEditProducts.map((product, index) => (
                    <MenuEditProductCard
                      key={product.id}
                      product={product}
                      position={index + 1}
                      total={menuEditProducts.length}
                      className="product-card menu-edit-product-card"
                      disabled={menuEditSaving}
                    />
                  ))}
                </SortableContext>
              )
            ) : products.length === 0 ? (
              <div className="menu-empty">
                <strong>No products found</strong>
                <span>
                  {search.length > 0
                    ? 'Try another search.'
                    : 'This category has no active products.'}
                </span>
              </div>
            ) : (
              products.map((product) => (
                <MenuProductCard
                  key={product.id}
                  product={product}
                  quantity={productQuantityInDraft(draft, product.id)}
                  busy={busy}
                  onQuickInfo={() => setQuickInfoProductId(product.id)}
                  onDecrement={() => decrementProduct(product)}
                  onAdd={() => addProduct(product)}
                  onExtras={() =>
                    setCustomizer({
                      kind: 'ADD',
                      productId: product.id,
                      focusSection: 'EXTRAS',
                    })
                  }
                />
              ))
            )}
          </div>'''
source, count = re.subn(
    r'          <div className="product-grid" aria-live="polite">[\s\S]*?\n          </div>',
    product_grid,
    source,
    count=1,
)
if count != 1:
    raise SystemExit(f'product grid: expected 1 match, found {count}')

source = replace_once(
    source,
    '      <section className="menu-pane" aria-label="Menu">\n        <>\n',
    '''      <section className="menu-pane" aria-label="Menu">
        <DndContext
          sensors={menuEditSensors}
          collisionDetection={closestCenter}
          onDragStart={handleMenuEditDragStart}
          onDragCancel={handleMenuEditDragCancel}
          onDragEnd={handleMenuEditDragEnd}
        >
          <>
''',
    'open dnd context',
)
source = replace_once(
    source,
    '        </>\n      </section>',
    '''          </>
          <DragOverlay>
            {activeDraggedProduct !== null ? (
              <article className="product-card menu-edit-product-card-dragging menu-edit-drag-overlay">
                <div className="product-main">
                  <ProductCardPresentation product={activeDraggedProduct} showDescription />
                </div>
              </article>
            ) : activeDraggedCategory !== null ? (
              <button
                type="button"
                className="category-tab category-tab-dragging menu-edit-drag-overlay"
              >
                {activeDraggedCategory.name}
              </button>
            ) : null}
          </DragOverlay>
        </DndContext>
      </section>''',
    'close dnd context',
)

ORDERS.write_text(source)

css = CSS_PATH.read_text()
css_marker = '.category-tab-reordering,\n.menu-edit-product-card {'
if css.count(css_marker) != 1:
    raise SystemExit(f'dnd css marker: expected 1 match, found {css.count(css_marker)}')
css_prefix = css[: css.index(css_marker)]
new_css = '''.category-tab-reordering,
.menu-edit-product-card {
  cursor: grab;
  user-select: none;
  touch-action: none;
  transform-origin: 50% 72%;
  will-change: transform;
}

.category-tab-dragging,
.menu-edit-product-card-dragging {
  animation-play-state: paused;
  border-color: color-mix(in srgb, var(--tux-accent) 58%, var(--tux-border-subtle));
  background: color-mix(in srgb, var(--tux-accent-soft) 28%, var(--tux-surface-panel));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--tux-text-primary) 11%, transparent);
  rotate: 0deg;
  translate: 0 -2px;
  scale: 1.01;
}

.menu-edit-drag-overlay {
  pointer-events: none;
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
    rotate: -0.2deg;
    translate: 0 0;
  }
  50% {
    rotate: 0.2deg;
    translate: 0 -0.5px;
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
    rotate: none;
    translate: none;
    scale: none;
  }
}
'''
CSS_PATH.write_text(css_prefix + new_css)
