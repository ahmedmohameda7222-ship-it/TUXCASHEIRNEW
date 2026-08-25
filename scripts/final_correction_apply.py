from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f'missing expected text in {path}: {old[:80]!r}')
    target.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, block: str) -> None:
    target = Path(path)
    text = target.read_text()
    if marker in text:
        return
    target.write_text(text.rstrip() + '\n\n' + block.strip() + '\n')


# Orders workspace behavior: left-default worker layout, 24px resize increment, and
# progressive search that keeps the category rail visible.
replace(
    'apps/operations/src/app/OrdersWorkspace.tsx',
    "const CART_RESIZE_KEYBOARD_STEP = 16;",
    "const CART_RESIZE_KEYBOARD_STEP = 24;",
)
replace(
    'apps/operations/src/app/OrdersWorkspace.tsx',
    "const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('center');",
    "const [categoryEditAlignment, setCategoryEditAlignment] = useState<CategoryAlignment>('left');",
)
replace(
    'apps/operations/src/app/OrdersWorkspace.tsx',
    "const categoryAlignment = categoryPreference?.categoryAlignment ?? 'center';",
    "const categoryAlignment = categoryPreference?.categoryAlignment ?? 'left';",
)
replace(
    'apps/operations/src/app/OrdersWorkspace.tsx',
    "setCategoryEditAlignment('center');",
    "setCategoryEditAlignment('left');",
)

old_toolbar = r'''          ) : categoryMode === 'SEARCH' ? (
            <div className="product-search category-search-inline">
              <SearchIcon className="category-search-glyph" />
              <input
                ref={searchRef}
                id="product-search"
                type="search"
                aria-label="Search menu"
                value={search}
                placeholder="Search products"
                autoComplete="off"
                onChange={(event) => {
                  const nextSearch = event.target.value;
                  setSearch(nextSearch);
                  if (nextSearch.trim().length > 0) setSelectedProductFamily(null);
                }}
              />
              <kbd>Ctrl K</kbd>
              <button
                type="button"
                className="category-search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearch('');
                  setCategoryMode('IDLE');
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="field-stack category-navigation-stack">
              <div className="category-navigation">
                <div
                  className="category-rail"
                  aria-label="Menu categories"
                  data-alignment={categoryAlignment}
                >
                  {activeCategories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      className={
                        selectedCategoryId === category.id
                          ? 'category-tab selected'
                          : 'category-tab'
                      }
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        setSelectedProductFamily(null);
                        setSearch('');
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <div className="category-nav-actions">
                  <button
                    type="button"
                    className="category-icon-action"
                    aria-label="Search menu"
                    title="Search menu"
                    onClick={() => setCategoryMode('SEARCH')}
                  >
                    <SearchIcon />
                  </button>
                  <button
                    type="button"
                    className="category-edit-action"
                    onClick={beginCategoryEdit}
                  >
                    <EditPencilIcon />
                    <span>Edit categories</span>
                  </button>
                </div>
              </div>
              {productFamilies.length > 1 ? (
                <div className="segmented-control" aria-label="Product families">
                  <button
                    type="button"
                    className={selectedProductFamily === null ? 'selected' : undefined}
                    onClick={() => setSelectedProductFamily(null)}
                  >
                    All
                  </button>
                  {productFamilies.map((family) => (
                    <button
                      type="button"
                      key={family}
                      className={selectedProductFamily === family ? 'selected' : undefined}
                      onClick={() => setSelectedProductFamily(family)}
                    >
                      {family}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}'''

new_toolbar = r'''          ) : (
            <div className="field-stack category-navigation-stack">
              <div className="category-navigation">
                <div
                  className="category-rail"
                  aria-label="Menu categories"
                  data-alignment={categoryAlignment}
                >
                  {activeCategories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      className={
                        selectedCategoryId === category.id
                          ? 'category-tab selected'
                          : 'category-tab'
                      }
                      onClick={() => {
                        setSelectedCategoryId(category.id);
                        setSelectedProductFamily(null);
                        setSearch('');
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <div className="category-nav-actions">
                  <button
                    type="button"
                    className="category-icon-action"
                    aria-label="Edit categories"
                    title="Edit categories"
                    onClick={beginCategoryEdit}
                  >
                    <EditPencilIcon />
                  </button>
                  {categoryMode === 'SEARCH' ? (
                    <div className="product-search category-search-inline">
                      <SearchIcon className="category-search-glyph" />
                      <input
                        ref={searchRef}
                        id="product-search"
                        type="search"
                        aria-label="Search menu"
                        value={search}
                        placeholder="Search products"
                        autoComplete="off"
                        onChange={(event) => {
                          const nextSearch = event.target.value;
                          setSearch(nextSearch);
                          if (nextSearch.trim().length > 0) setSelectedProductFamily(null);
                        }}
                      />
                      <button
                        type="button"
                        className="category-search-clear"
                        aria-label="Clear search"
                        title="Clear search"
                        onClick={() => {
                          setSearch('');
                          setCategoryMode('IDLE');
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="category-icon-action"
                      aria-label="Search menu"
                      title="Search menu"
                      onClick={() => setCategoryMode('SEARCH')}
                    >
                      <SearchIcon />
                    </button>
                  )}
                </div>
              </div>
              {productFamilies.length > 1 ? (
                <div className="segmented-control" aria-label="Product families">
                  <button
                    type="button"
                    className={selectedProductFamily === null ? 'selected' : undefined}
                    onClick={() => setSelectedProductFamily(null)}
                  >
                    All
                  </button>
                  {productFamilies.map((family) => (
                    <button
                      type="button"
                      key={family}
                      className={selectedProductFamily === family ? 'selected' : undefined}
                      onClick={() => setSelectedProductFamily(family)}
                    >
                      {family}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}'''
replace('apps/operations/src/app/OrdersWorkspace.tsx', old_toolbar, new_toolbar)

# Electron reset semantics must match browser/default semantics.
replace(
    'apps/operations-desktop/src/main/workerUiPreferencesIpc.ts',
    "await this.update({ categoryOrder: [], categoryAlignment: 'center' });",
    "await this.update({ categoryOrder: [], categoryAlignment: 'left' });",
)
replace(
    'apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts',
    "categoryAlignment: 'center',\n      syncState: 'DIRTY',",
    "categoryAlignment: 'left',\n      syncState: 'DIRTY',",
)

# Deterministic rendered QA uses the approved real menu descriptions without changing
# product names relied on by existing test flows.
replace(
    'e2e/operations.e2e.ts',
    "description:\n      index === 7 ? 'Development-only long text used to stress responsive menu layout.' : null,",
    "description:\n      index === 0\n        ? '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'\n        : index === 1\n          ? '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n          : index === 2\n            ? '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n            : index === 3\n              ? '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'\n              : index === 7\n                ? 'Development-only long text used to stress responsive menu layout.'\n                : index === 10\n                  ? 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'\n                  : null,",
)

# Exact visual correction values. Keep this as one final authority layer so the older
# approved premium system remains intact underneath it.
append_once(
    'apps/operations/src/styles/premium.css',
    '/* Final correction authority: 2026-08-25. */',
    r'''
/* Final correction authority: 2026-08-25. */
.operations-shell {
  --tux-floating-header-space: 5.5rem;
}

.operations-header {
  height: 64px;
  min-height: 64px;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  padding: 0 16px;
}

.operations-header .tux-brand {
  width: auto;
  height: 44px;
  min-width: 0;
  min-height: 0;
  padding: 0;
  object-fit: contain;
}

.operations-header .nav-item {
  min-height: 44px;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
}

.operations-header .nav-item-active {
  font-weight: 600;
}

.menu-toolbar {
  min-height: 56px;
  padding: 5px 8px;
}

.menu-toolbar:not(.category-mode-edit) {
  height: 56px;
}

.menu-toolbar .category-rail {
  gap: 6px;
  padding: 0;
}

.menu-toolbar .category-rail .category-tab {
  height: 44px;
  min-height: 44px;
  padding-inline: 16px;
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
}

.menu-toolbar .category-rail .category-tab.selected {
  font-weight: 600;
}

.menu-toolbar .category-icon-action,
.menu-toolbar .category-search-clear {
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  padding: 0;
}

.menu-toolbar .category-icon-action svg,
.menu-toolbar .category-search-glyph,
.menu-toolbar .category-search-clear svg {
  width: 20px;
  height: 20px;
}

.product-grid {
  gap: 8px;
}

.product-card {
  min-height: 0;
  border-radius: 12px;
}

.product-card:has(.product-copy p) {
  min-height: 152px;
}

.product-main {
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
}

.product-media {
  width: 68px;
  height: 68px;
}

.product-image-fallback {
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  background: color-mix(in srgb, var(--tux-surface-subtle) 72%, var(--tux-surface-panel));
}

.product-copy strong {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.product-copy p {
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
}

.product-card-footer {
  min-height: 52px;
  border-top-color: color-mix(in srgb, var(--tux-border-subtle) 55%, transparent);
}

.product-price {
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.product-extra-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.product-extra-action svg,
.line-extra-action svg {
  width: 20px;
  height: 20px;
}

.product-quantity {
  min-height: 44px;
  background: color-mix(in srgb, var(--tux-surface-subtle) 72%, var(--tux-surface-panel));
}

.product-card .product-quantity,
.quantity-control {
  grid-template-columns: 44px 2rem 44px;
}

.product-quantity button,
.quantity-control button {
  width: 44px;
  height: 44px;
  min-height: 44px;
}

.product-quantity output,
.quantity-control output {
  font-size: 15px;
  line-height: 18px;
  font-weight: 600;
}

.product-quantity-badge {
  min-width: 24px;
  height: 24px;
  font-size: 13px;
  line-height: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.cart-heading,
.cart-section,
.cart-totals {
  padding-inline: 16px;
}

.cart-heading .cart-title {
  font-size: 17px;
  line-height: 22px;
  font-weight: 600;
}

.cart-count {
  font-size: 13px;
  line-height: 16px;
  font-weight: 400;
}

.cart-heading .quiet-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.cart-line {
  min-height: 96px;
  border-bottom-color: color-mix(in srgb, var(--tux-border-subtle) 58%, transparent);
}

.cart-line:has(.line-meta) {
  min-height: 112px;
}

.cart-line-top > div > strong {
  font-size: 15px;
  line-height: 20px;
  font-weight: 600;
}

.cart-line-top > strong {
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.cart-line-top > div > span,
.line-meta,
.line-note,
.fee-reference,
.payment-summary {
  font-size: 13px;
  line-height: 16px;
  font-weight: 400;
}

.line-actions {
  gap: 8px;
}

.line-actions button {
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--tux-border-subtle) 72%, transparent);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-subtle);
  padding: 0 12px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.line-actions button + button {
  margin-left: 0;
}

.line-actions button:first-child,
.line-actions button:last-child {
  border-radius: var(--tux-radius-sm);
}

.line-actions button:nth-child(-n + 2) {
  width: 44px;
  min-width: 44px;
  height: 44px;
  padding: 0;
}

.order-type-section .segmented-control,
.payment-section .payment-methods {
  padding: 0;
  border-color: color-mix(in srgb, var(--tux-border-subtle) 65%, transparent);
  background: transparent;
}

.order-type-section .segmented-control button,
.payment-section .payment-methods button,
.split-payment-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.adjustment-disclosure {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 500;
}

.money-input-wrap,
.field-stack input,
.field-stack select {
  min-height: 44px;
}

.money-input-wrap > span {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
}

.payment-section .field-stack > span,
.payment-section .money-field > label,
.payment-section .split-remainder > span {
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
}

.payment-section select,
.payment-section .money-input-wrap input,
.payment-section .split-remainder > strong {
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
}

.tender-suggestions {
  gap: 6px;
}

.tender-suggestions button {
  min-height: 44px;
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
}

.cart-totals dt,
.cart-totals dd {
  font-size: 14px;
  line-height: 18px;
}

.cart-totals dt {
  font-weight: 400;
}

.cart-totals dd {
  font-weight: 500;
}

.cart-totals .grand-total dt {
  font-size: 18px;
  line-height: 22px;
  font-weight: 600;
}

.cart-totals .grand-total dd {
  font-size: 22px;
  line-height: 26px;
  font-weight: 700;
}

.place-order-action {
  min-height: 48px;
  font-size: 16px;
  line-height: 20px;
  font-weight: 600;
}

@media (max-width: 74rem) and (min-width: 54.0625rem) {
  .operations-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
}
''',
)

append_once(
    'apps/operations/src/styles/orders.css',
    '/* Final correction category/search composition. */',
    r'''
/* Final correction category/search composition. */
.category-navigation-stack {
  min-height: 44px;
  gap: 6px;
}

.category-navigation {
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
}

.category-rail {
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.category-rail::-webkit-scrollbar {
  display: none;
}

.category-nav-actions {
  gap: 6px;
}

.product-search.category-search-inline {
  width: clamp(240px, 21vw, 300px);
  max-width: 320px;
  grid-template-columns: 20px minmax(0, 1fr) 44px;
  gap: 0;
  min-height: 44px;
  border: 1px solid var(--tux-border-subtle);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-subtle);
  overflow: hidden;
}

.product-search.category-search-inline input {
  height: 42px;
  min-height: 42px;
  border: 0;
  background: transparent;
  padding: 0 10px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
  outline: 0;
}

.category-search-glyph {
  margin-left: 10px;
  color: var(--tux-text-secondary);
}

.category-search-clear {
  border: 0;
  border-left: 1px solid color-mix(in srgb, var(--tux-border-subtle) 55%, transparent);
  border-radius: 0;
  background: transparent;
  color: var(--tux-text-secondary);
  font-size: 22px;
  line-height: 1;
  font-weight: 400;
}

.category-search-clear:hover {
  color: var(--tux-text-primary);
}

.category-navigation-stack > .segmented-control {
  min-height: 44px;
}

@media (max-width: 54rem) {
  .product-search.category-search-inline {
    width: clamp(240px, 40vw, 300px);
  }
}

@media (max-width: 44rem) {
  .category-navigation {
    align-items: start;
  }

  .category-nav-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .product-search.category-search-inline {
    width: min(300px, calc(100vw - 7rem));
    min-width: 240px;
  }
}
''',
)

# Focused rendered authority for the measurable correction values.
append_once(
    'e2e/operations.e2e.ts',
    "test('final correction keeps header and categories visible during compact search'",
    r'''
test('final correction keeps header and categories visible during compact search', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  const header = page.locator('.operations-header');
  const headerBox = await header.boundingBox();
  const headerStyle = await header.evaluate((node) => getComputedStyle(node));
  expect(headerBox).not.toBeNull();
  expect(Math.round(headerBox!.height)).toBe(64);
  expect(headerStyle.paddingLeft).toBe('16px');
  expect(headerStyle.paddingRight).toBe('16px');
  const logoBox = await header.getByRole('img', { name: 'TUX' }).boundingBox();
  expect(logoBox).not.toBeNull();
  expect(Math.round(logoBox!.height)).toBe(44);
  const categories = page.getByLabel('Menu categories');
  await expect(categories).toHaveAttribute('data-alignment', 'left');
  expect((await categories.evaluate((node) => getComputedStyle(node))).gap).toBe('6px');
  const toolbarBox = await page.locator('.menu-toolbar').boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(Math.round(toolbarBox!.height)).toBe(56);
  const actionButtons = page.locator('.category-nav-actions > button');
  await expect(actionButtons).toHaveCount(2);
  await expect(actionButtons.nth(0)).toHaveAccessibleName('Edit categories');
  await expect(actionButtons.nth(1)).toHaveAccessibleName('Search menu');
  await page.getByRole('button', { name: 'Search menu' }).click();
  await expect(header).toBeVisible();
  await expect(categories).toBeVisible();
  const search = page.locator('.category-search-inline');
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(Math.round(searchBox!.width)).toBe(300);
  await expect(search.locator('kbd')).toHaveCount(0);
  const input = page.getByPlaceholder('Search products');
  await expect(input).toBeFocused();
  const inputStyle = await input.evaluate((node) => getComputedStyle(node));
  expect(inputStyle.fontSize).toBe('14px');
  expect(inputStyle.lineHeight).toBe('18px');
  expect(Number(inputStyle.fontWeight)).toBe(400);
  const clear = search.getByRole('button', { name: 'Clear search' });
  await expect(clear).toHaveText('×');
  const clearBox = await clear.boundingBox();
  expect(clearBox).not.toBeNull();
  expect(Math.round(clearBox!.width)).toBe(44);
  expect(Math.round(clearBox!.height)).toBe(44);
});

test('final correction keeps product controls cashier-sized', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  const gridStyle = await page.locator('.product-grid').evaluate((node) => getComputedStyle(node));
  expect(gridStyle.rowGap).toBe('8px');
  expect(gridStyle.columnGap).toBe('8px');
  const card = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
  expect((await card.evaluate((node) => getComputedStyle(node))).borderRadius).toBe('12px');
  const media = await card.locator('.product-media').boundingBox();
  expect(media).not.toBeNull();
  expect(Math.round(media!.width)).toBe(68);
  expect(Math.round(media!.height)).toBe(68);
  const price = await card.locator('.product-price').evaluate((node) => getComputedStyle(node));
  expect(price.fontSize).toBe('14px');
  expect(price.lineHeight).toBe('18px');
  expect(Number(price.fontWeight)).toBe(500);
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  expect(Math.round((await extra.boundingBox())!.height)).toBe(44);
  expect(Math.round((await extra.locator('svg').boundingBox())!.width)).toBe(20);
  const stepper = card.getByLabel('Classic Smash quantity');
  for (const button of [
    stepper.getByRole('button', { name: 'Remove one Classic Smash' }),
    stepper.getByRole('button', { name: 'Add one Classic Smash' }),
  ]) {
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }
  await stepper.getByRole('button', { name: 'Add one Classic Smash' }).click();
  const badge = card.locator('.product-quantity-badge');
  const badgeBox = await badge.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(badgeBox!.width).toBeGreaterThanOrEqual(24);
  expect(badgeBox!.height).toBeGreaterThanOrEqual(24);
  const badgeStyle = await badge.evaluate((node) => getComputedStyle(node));
  expect(badgeStyle.fontSize).toBe('13px');
  expect(badgeStyle.lineHeight).toBe('16px');
  expect(Number(badgeStyle.fontWeight)).toBe(600);
});

test('final correction keeps cart and payment controls at visible target sizes', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
  await card.getByRole('button', { name: 'Extra', exact: true }).click();
  const customizer = page.getByRole('dialog', { name: 'Classic Smash' });
  await customizer.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await customizer.getByRole('button', { name: /Add to order/i }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', { name: 'Current order' });
  const clear = cart.getByRole('button', { name: 'Clear', exact: true });
  const clearStyle = await clear.evaluate((node) => getComputedStyle(node));
  expect(clearStyle.fontSize).toBe('14px');
  expect(clearStyle.lineHeight).toBe('18px');
  expect(Number(clearStyle.fontWeight)).toBe(500);
  const line = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' }).first();
  for (const name of ['−1', '+1']) {
    const box = await line.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }
  for (const name of ['Edit', 'Extra']) {
    const button = line.getByRole('button', { name, exact: true });
    expect(Math.round((await button.boundingBox())!.height)).toBe(44);
    const style = await button.evaluate((node) => getComputedStyle(node));
    expect(style.fontSize).toBe('14px');
    expect(style.lineHeight).toBe('18px');
    expect(Number(style.fontWeight)).toBe(500);
  }
  expect(Math.round((await cart.getByRole('button', { name: 'Take Away' }).boundingBox())!.height)).toBe(44);
  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cash = cart.getByLabel('Cash received');
  await expect(cash).toHaveValue('');
  await expect(cash).toHaveAttribute('placeholder', '0');
  expect(Math.round((await cash.boundingBox())!.height)).toBe(44);
  const tenders = cart.getByLabel('Smart Cash tenders');
  expect((await tenders.evaluate((node) => getComputedStyle(node))).gap).toBe('6px');
  expect(Math.round((await tenders.getByRole('button').first().boundingBox())!.height)).toBe(44);
  const split = cart.getByRole('button', { name: 'Split payment' });
  expect(Math.round((await split.boundingBox())!.height)).toBe(44);
  await split.click();
  await expect(cart.getByLabel('Method A')).toBeVisible();
  await expect(cart.getByLabel('Amount A')).toBeVisible();
  await expect(cart.getByLabel('Method B')).toBeVisible();
  await expect(cart.getByText('Amount B', { exact: true })).toBeVisible();
  await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
  await expect(cart.getByLabel('Cash received B')).toHaveCount(0);
});

test('final correction resizes Current Order by 24px per keyboard step', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  const cart = page.locator('.desktop-cart-wrap');
  const before = await cart.boundingBox();
  expect(before).not.toBeNull();
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  const after = await cart.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.round(Math.abs(after!.width - before!.width))).toBe(24);
});
''',
)
