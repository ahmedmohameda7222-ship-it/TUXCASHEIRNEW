from pathlib import Path
import re

# Apply only the explicitly approved POS UI changes.
workspace_path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
workspace = workspace_path.read_text()

start = workspace.find('  const activeFamilies = useMemo(')
end = workspace.find('\n\n  useEffect(() => {', start)
if start < 0 or end < 0:
    raise SystemExit('activeFamilies anchors not found')
workspace = workspace[:start] + '''  const activeFamilies = useMemo(() => {
  const selectedCategory = activeCategories.find(
    (category) => category.id === selectedCategoryId,
  );
  if (selectedCategory?.name.trim().toLocaleLowerCase() !== 'burgers') return [];
  return productFamiliesForCategory(configuration?.products ?? [], selectedCategoryId);
}, [activeCategories, configuration, selectedCategoryId]);''' + workspace[end:]

quick_start = workspace.find('function QuickInfo({')
quick_end = workspace.find('\n\nexport function OrdersWorkspace', quick_start)
if quick_start < 0 or quick_end < 0:
    raise SystemExit('QuickInfo anchors not found')
quick_info = '''function QuickInfo({
  product,
  busy,
  onClose,
}: {
  readonly product: Product;
  readonly busy: boolean;
  readonly onClose: () => void;
}) {
  return (
    <div
      className="orders-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        className="quick-info"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-info-title"
      >
        <div className="quick-info-media">
          <ProductImage product={product} />
        </div>
        <div className="quick-info-body">
          <span className="drawer-kicker">Quick Info</span>
          <h2 id="quick-info-title">{product.name}</h2>
          <strong>{formatMoneyMinor(product.priceMinor)}</strong>
          <p>{product.description?.trim() || 'No product description has been added yet.'}</p>
          {product.soldOut ? <span className="sold-out-label">Sold Out</span> : null}
        </div>
        <div className="drawer-footer">
          <button type="button" className="secondary-action" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}'''
workspace = workspace[:quick_start] + quick_info + workspace[quick_end:]

call_start = workspace.find('        <QuickInfo\n          product={quickInfoProduct}')
call_end = workspace.find('\n        />', call_start)
if call_start < 0 or call_end < 0:
    raise SystemExit('QuickInfo callsite anchors not found')
call_end += len('\n        />')
workspace = workspace[:call_start] + '''        <QuickInfo
          product={quickInfoProduct}
          busy={busy}
          onClose={() => setQuickInfoProductId(null)}
        />''' + workspace[call_end:]
workspace_path.write_text(workspace)

card_path = Path('apps/operations/src/app/MenuProductCard.tsx')
card = card_path.read_text()
card, count = re.subn(
    r"\n\s*const description = product\.description\?\.trim\(\) \?\? '';",
    '',
    card,
    count=1,
)
if count != 1:
    raise SystemExit('product card description declaration not found')
card, count = re.subn(
    r"\n\s*\{description\.length > 0 \? <p>\{description\}</p> : null\}",
    '',
    card,
    count=1,
)
if count != 1:
    raise SystemExit('product card description render not found')

footer_start = card.find('      <footer className="product-card-footer">')
footer_end = card.find('\n      </footer>', footer_start)
if footer_start < 0 or footer_end < 0:
    raise SystemExit('product card footer anchors not found')
footer_end += len('\n      </footer>')
new_footer = '''      <footer className="product-card-footer">
        <strong className="product-price">{formatMoneyMinor(product.priceMinor)}</strong>
        {supportsExtras ? (
          <button
            type="button"
            className="product-extra-action"
            disabled={busy || product.soldOut}
            onClick={(event) => runIndependentAction(event, onExtras)}
          >
            <PlusCircleIcon />
            <span>Extra</span>
          </button>
        ) : null}
        <div className="product-card-controls">
          <div className="product-quantity" aria-label={`${product.name} quantity`}>
            <button
              type="button"
              aria-label={`Remove one ${product.name}`}
              disabled={busy || quantity === 0}
              onClick={(event) => runIndependentAction(event, onDecrement)}
            >
              −
            </button>
            <output>{quantity}</output>
            <button
              type="button"
              aria-label={`Add one ${product.name}`}
              disabled={busy || product.soldOut}
              onClick={(event) => runIndependentAction(event, onAdd)}
            >
              +
            </button>
          </div>
        </div>
      </footer>'''
card = card[:footer_start] + new_footer + card[footer_end:]
card_path.write_text(card)

css_path = Path('apps/operations/src/styles/final-pos-corrections.css')
css = css_path.read_text()
css = re.sub(
    r"\n\.product-card:has\(\.product-copy p\) \{\n  min-height: 152px;\n\}",
    '',
    css,
    count=1,
)
marker = '/* User-approved Burger subcategory row and product action order. */'
if marker not in css:
    css += '''

/* User-approved Burger subcategory row and product action order. */
.menu-toolbar:not(.category-mode-edit):has(.product-family-filter) {
  height: auto;
  min-height: 56px;
  padding: 5px 8px 8px;
}

.menu-toolbar:not(.category-mode-edit)
  > .category-navigation-stack:has(.product-family-filter) {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 44px 44px;
  row-gap: 6px;
  align-items: stretch;
}

.menu-toolbar:not(.category-mode-edit)
  > .category-navigation-stack:has(.product-family-filter)
  .category-navigation {
  grid-row: 1;
  width: 100%;
  min-width: 0;
  min-height: 44px;
}

.menu-toolbar:not(.category-mode-edit)
  > .category-navigation-stack:has(.product-family-filter)
  .product-family-filter {
  grid-row: 2;
  width: fit-content;
  max-width: 100%;
  justify-self: start;
  align-self: center;
}

.product-card {
  height: max-content;
}

.product-card > .product-main {
  flex: 0 0 auto;
}

.product-card-footer {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 8px;
  row-gap: 8px;
  flex-wrap: nowrap;
}

.product-card-footer > .product-price {
  grid-column: 1;
  justify-self: start;
}

.product-card-footer > .product-extra-action {
  grid-column: 2;
  justify-self: center;
  margin: 0;
}

.product-card-footer > .product-card-controls {
  grid-column: 3;
  min-width: max-content;
  justify-self: end;
  flex-wrap: nowrap;
}

.product-card-footer .product-quantity {
  margin: 0;
}

@media (max-width: 34rem) {
  .product-grid {
    grid-auto-rows: max-content;
  }

  .product-card-footer {
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding-inline: 8px;
    column-gap: 6px;
  }
}
'''
css_path.write_text(css)

# Update only regression expectations made obsolete by the approved change.
e2e_path = Path('e2e/operations.e2e.ts')
e2e = e2e_path.read_text()
old_desc_start = e2e.find("  const stressCard = page.locator('.product-card').filter({ hasText: 'Johnny’s' }).first();")
old_desc_end = e2e.find("\n  expect(\n    (await stressCard.locator('.product-price')", old_desc_start)
if old_desc_start < 0 or old_desc_end < 0:
    raise SystemExit('typography description anchors not found')
replacement = '''  const stressCard = page.locator('.product-card').filter({ hasText: 'Johnny’s' }).first();
  const productName = stressCard.locator('.product-copy strong');
  const productNameStyle = await productName.evaluate((node) => getComputedStyle(node));
  expect(productNameStyle.fontSize).toBe('15px');
  expect(productNameStyle.lineHeight).toBe('20px');
  expect(Number(productNameStyle.fontWeight)).toBe(600);
  await expect(stressCard.locator('.product-copy p')).toHaveCount(0);'''
e2e = e2e[:old_desc_start] + replacement + e2e[old_desc_end:]

e2e = e2e.replace(
    "  expect(Math.round(toolbarBox!.height)).toBe(56);",
    "  expect(toolbarBox!.height).toBeGreaterThan(56);",
    1,
)
e2e = e2e.replace(
    "  expect(footerStyle.flexWrap).toBe('wrap');",
    "  expect(footerStyle.display).toBe('grid');",
    1,
)
e2e = e2e.replace(
    "  await expect(described.locator('.product-copy p')).toHaveCount(1);",
    "  await expect(described.locator('.product-copy p')).toHaveCount(0);",
    1,
)
e2e = e2e.replace(
    "  expect(describedStyle.minHeight).toBe('152px');",
    "  expect(describedStyle.minHeight).toBe('0px');",
    1,
)

marker = "test('Burger family filter appears below main categories only for Burgers'"
if marker not in e2e:
    e2e += r'''

test('Burger family filter appears below main categories only for Burgers', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const primary = page.getByLabel('Menu categories');
  await primary.getByRole('button', { name: 'Burgers', exact: true }).click();
  const families = page.getByLabel('Product families');
  await expect(families).toBeVisible();
  await expect(families.getByRole('button')).toHaveText(['All', 'TUX', 'TUXIFY']);
  await expect(primary.getByRole('button', { name: 'All', exact: true })).toHaveCount(0);
  const [primaryBox, familyBox] = await Promise.all([primary.boundingBox(), families.boundingBox()]);
  expect(primaryBox).not.toBeNull();
  expect(familyBox).not.toBeNull();
  expect(familyBox!.y).toBeGreaterThanOrEqual(primaryBox!.y + primaryBox!.height - 1);
  await primary.getByRole('button', { name: 'Fries', exact: true }).click();
  await expect(page.getByLabel('Product families')).toHaveCount(0);
});

test('product description appears only after opening the product card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(card.locator('.product-copy p')).toHaveCount(0);
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const dialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.quick-info-body p')).toContainText('1 smashed patty');
});

test('Quick Info is informational only and has no Customize and add action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const dialog = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.quick-info-body p')).toContainText('1 smashed patty');
  await expect(dialog.getByRole('button', { name: 'Customize & add' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
});

test('Extra is centered between price and quantity controls on the product card', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  const price = card.locator('.product-price');
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  const quantity = card.locator('.product-quantity');
  const [priceBox, extraBox, quantityBox, cardBox] = await Promise.all([
    price.boundingBox(), extra.boundingBox(), quantity.boundingBox(), card.boundingBox(),
  ]);
  expect(priceBox).not.toBeNull();
  expect(extraBox).not.toBeNull();
  expect(quantityBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(extraBox!.x).toBeGreaterThan(priceBox!.x + priceBox!.width);
  expect(extraBox!.x + extraBox!.width).toBeLessThan(quantityBox!.x);
  const gapCenter = (priceBox!.x + priceBox!.width + quantityBox!.x) / 2;
  const extraCenter = extraBox!.x + extraBox!.width / 2;
  expect(Math.abs(extraCenter - gapCenter)).toBeLessThanOrEqual(12);
});

test('requested compact product card controls do not overlap on 375px mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);
  const cards = page.locator('.product-card');
  const card = cards.filter({ hasText: 'Single Smashed Patty' }).first();
  const nextCard = cards.filter({ hasText: 'Double Smashed Patty' }).first();
  await expect(card.locator('.product-copy p')).toHaveCount(0);
  const price = card.locator('.product-price');
  const extra = card.getByRole('button', { name: 'Extra', exact: true });
  const quantity = card.locator('.product-quantity');
  const [cardBox, nextCardBox, priceBox, extraBox, quantityBox] = await Promise.all([
    card.boundingBox(), nextCard.boundingBox(), price.boundingBox(), extra.boundingBox(), quantity.boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(nextCardBox).not.toBeNull();
  for (const box of [priceBox, extraBox, quantityBox]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(cardBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  }
  expect(nextCardBox!.y).toBeGreaterThanOrEqual(cardBox!.y + cardBox!.height + 7);
  await extra.click();
  await expect(page.locator('.product-customizer')).toBeVisible();
});
'''
e2e_path.write_text(e2e)
