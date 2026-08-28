from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
source = path.read_text()

old_import = "import { filterProductsForMenu as filterProductsForMenuWithPreference } from './menuProductOrder';\n"
new_import = """import {
  filterProductsForMenu as filterProductsForMenuWithPreference,
  moveProductWithinCategory,
  reconcileProductOrder,
} from './menuProductOrder';
"""
if source.count(old_import) != 1:
    raise SystemExit('menu product order import not found exactly once')
source = source.replace(old_import, new_import, 1)

position_import = "import { ProductPositionEditor } from './ProductPositionEditor';\n"
if source.count(position_import) != 1:
    raise SystemExit('ProductPositionEditor import not found exactly once')
source = source.replace(position_import, '', 1)

old_state = """  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);
  const [productReorderCategoryId, setProductReorderCategoryId] = useState<MenuCategoryId | null>(
    null,
  );
"""
new_state = """  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);
  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);
  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);
"""
if source.count(old_state) != 1:
    raise SystemExit('product reorder state block not found exactly once')
source = source.replace(old_state, new_state, 1)

if source.count('    setProductReorderCategoryId(null);\n') != 2:
    raise SystemExit('expected exactly two product reorder reset references')
source = source.replace('    setProductReorderCategoryId(null);\n', '', 2)

old_product_const = """  const productReorderCategory =
    productReorderCategoryId === null
      ? null
      : (configuredActiveCategories.find((category) => category.id === productReorderCategoryId) ??
        null);

"""
new_product_const = """  const menuEditProducts = useMemo(() => {
    if (selectedCategoryId === null) return [];
    const byId = new Map(
      (configuration?.products ?? [])
        .filter((product) => product.active)
        .map((product) => [product.id, product]),
    );
    return menuEditProductOrder.flatMap((productId) => {
      const product = byId.get(productId);
      return product !== undefined && product.categoryId === selectedCategoryId ? [product] : [];
    });
  }, [configuration, menuEditProductOrder, selectedCategoryId]);

"""
if source.count(old_product_const) != 1:
    raise SystemExit('product reorder category const not found exactly once')
source = source.replace(old_product_const, new_product_const, 1)

old_begin = """    setCategoryEditOrder(activeCategories.map((category) => category.id));
    setCategoryEditAlignment(categoryAlignment);
    setDraggedCategoryId(null);
    setMenuEditActive(true);
"""
new_begin = """    setCategoryEditOrder(activeCategories.map((category) => category.id));
    setCategoryEditAlignment(categoryAlignment);
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    );
    setDraggedCategoryId(null);
    setDraggedProductId(null);
    setMenuEditActive(true);
"""
if source.count(old_begin) != 1:
    raise SystemExit('begin menu edit block not found exactly once')
source = source.replace(old_begin, new_begin, 1)

anchor = "  function addProduct(product: Product): void {\n"
if source.count(anchor) != 1:
    raise SystemExit('addProduct anchor not found exactly once')
move_product = '''  function moveDraggedProduct(targetId: ProductId): void {
    const sourceId = draggedProductId;
    if (sourceId === null || sourceId === targetId || selectedCategoryId === null) return;
    const productCategoryById = new Map(
      (configuration?.products ?? []).map((product) => [product.id, product.categoryId]),
    );
    setMenuEditProductOrder((current) => {
      const categoryProductIds = current.filter(
        (productId) => productCategoryById.get(productId) === selectedCategoryId,
      );
      return moveProductWithinCategory(current, categoryProductIds, sourceId, targetId);
    });
  }

'''
source = source.replace(anchor, move_product + anchor, 1)

section_open = '''      <section className="menu-pane" aria-label="Menu">
        {productReorderCategory === null ? (
          <>
'''
if source.count(section_open) != 1:
    raise SystemExit('menu pane product editor conditional opening not found')
source = source.replace(
    section_open,
    '''      <section className="menu-pane" aria-label="Menu">
        <>
''',
    1,
)

editor_start = source.find('        ) : (\n          <ProductPositionEditor')
editor_end_marker = '        )}\n      </section>'
editor_end = source.find(editor_end_marker, editor_start)
if editor_start < 0 or editor_end < 0:
    raise SystemExit('ProductPositionEditor render branch not found')
source = source[:editor_start] + '      </section>' + source[editor_end + len(editor_end_marker):]

product_grid_start = source.find('            <div className="product-grid" aria-live="polite">')
product_grid_end_marker = '            </div>\n          </>'
product_grid_end = source.find(product_grid_end_marker, product_grid_start)
if product_grid_start < 0 or product_grid_end < 0:
    raise SystemExit('product grid block not found')

product_grid = '''            <div className="product-grid" aria-live="polite">
              {menuEditActive ? (
                menuEditProducts.length === 0 ? (
                  <div className="menu-empty">
                    <strong>No products found</strong>
                    <span>This category has no active products.</span>
                  </div>
                ) : (
                  menuEditProducts.map((product) => (
                    <article
                      key={product.id}
                      className={[
                        'product-card',
                        'menu-edit-product-card',
                        draggedProductId === product.id ? 'menu-edit-product-card-dragging' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable={menuEditActive && draggedProductId !== product.id}
                      tabIndex={0}
                      aria-label={`Reorder ${product.name}`}
                      onDragStart={(event) => {
                        setDraggedProductId(product.id);
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', product.id);
                      }}
                      onDragEnter={(event) => {
                        if (draggedProductId === null) return;
                        event.preventDefault();
                        moveDraggedProduct(product.id);
                      }}
                      onDragOver={(event) => {
                        if (draggedProductId !== null) event.preventDefault();
                      }}
                      onDragEnd={() => setDraggedProductId(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setDraggedProductId(null);
                      }}
                    >
                      <div className="product-main">
                        <div className="product-media">
                          <ProductImage product={product} />
                        </div>
                        <div className="product-copy">
                          <strong>{product.name}</strong>
                          {product.description?.trim() ? <p>{product.description}</p> : null}
                        </div>
                        <strong className="product-price">
                          {formatMoneyMinor(product.priceMinor)}
                        </strong>
                      </div>
                      <div className="menu-edit-product-hint" aria-hidden="true">
                        Drag to reorder
                      </div>
                    </article>
                  ))
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
                      setCustomizer({ kind: 'ADD', productId: product.id, focusSection: 'EXTRAS' })
                    }
                  />
                ))
              )}
            </div>
'''
source = source[:product_grid_start] + product_grid + source[product_grid_end:]

path.write_text(source)
