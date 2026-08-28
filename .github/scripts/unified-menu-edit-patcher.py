import re
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
if 'moveProductWithinCategory' not in source:
    source = source.replace(old_import, new_import, 1)
source = source.replace("import { ProductPositionEditor } from './ProductPositionEditor';\n", '', 1)

if 'menuEditProductOrder' not in source:
    dragged_category_state = (
        '  const [draggedCategoryId, setDraggedCategoryId] = useState<MenuCategoryId | null>(null);\n'
    )
    source = source.replace(
        dragged_category_state,
        dragged_category_state
        + '  const [menuEditProductOrder, setMenuEditProductOrder] = useState<readonly ProductId[]>([]);\n'
        + '  const [draggedProductId, setDraggedProductId] = useState<ProductId | null>(null);\n',
        1,
    )

source, removed_state = re.subn(
    r"  const \[productReorderCategoryId, setProductReorderCategoryId\] = useState<MenuCategoryId \| null>\(\n    null,\n  \);\n",
    '',
    source,
    count=1,
)
if removed_state != 1 and 'productReorderCategoryId' in source:
    raise SystemExit('Could not remove productReorderCategoryId state')
source = re.sub(r'^\s*setProductReorderCategoryId\(null\);\n', '', source, flags=re.MULTILINE)

menu_edit_products = """  const menuEditProducts = useMemo(() => {
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
source, replaced_const = re.subn(
    r"  const productReorderCategory =[\s\S]*?\n\n  const validation",
    menu_edit_products + '  const validation',
    source,
    count=1,
)
if replaced_const != 1 and 'const menuEditProducts' not in source:
    raise SystemExit('Could not replace productReorderCategory derived state')

if 'reconcileProductOrder(configuration?.products ?? [], categoryPreference)' not in source:
    source = source.replace(
        '    setCategoryEditAlignment(categoryAlignment);\n',
        """    setCategoryEditAlignment(categoryAlignment);
    setMenuEditProductOrder(
      reconcileProductOrder(configuration?.products ?? [], categoryPreference).map(
        (product) => product.id,
      ),
    );
""",
        1,
    )
    source = source.replace(
        '    setDraggedCategoryId(null);\n    setMenuEditActive(true);\n',
        '    setDraggedCategoryId(null);\n    setDraggedProductId(null);\n    setMenuEditActive(true);\n',
        1,
    )

if 'function moveDraggedProduct' not in source:
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
    source = source.replace('  function addProduct(product: Product): void {\n', move_product + '  function addProduct(product: Product): void {\n', 1)

source = source.replace(
    '        {productReorderCategory === null ? (\n          <>\n',
    '        <>\n',
    1,
)
source, removed_editor = re.subn(
    r"\n        \) : \(\n          <ProductPositionEditor[\s\S]*?\n        \)\}\n",
    '\n',
    source,
    count=1,
)
if removed_editor != 1 and '<ProductPositionEditor' in source:
    raise SystemExit('Could not remove ProductPositionEditor render branch')

product_grid_start = source.find('            <div className="product-grid" aria-live="polite">')
product_grid_end_marker = '            </div>\n          </>'
product_grid_end = source.find(product_grid_end_marker, product_grid_start)
if product_grid_start < 0 or product_grid_end < 0:
    raise SystemExit('Could not locate product grid')

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

if 'productReorderCategoryId' in source or '<ProductPositionEditor' in source:
    raise SystemExit('Legacy product reorder path remains after Task 4 transform')
if 'menuEditProductOrder' not in source or 'menu-edit-product-card' not in source:
    raise SystemExit('Task 4 inline product draft was not installed')

path.write_text(source)
