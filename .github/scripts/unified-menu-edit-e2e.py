import re
from pathlib import Path

path = Path('e2e/operations.e2e.ts')
source = path.read_text()


def replace_test(name: str, replacement: str) -> None:
    global source
    pattern = rf"test\('{re.escape(name)}'[\s\S]*?\n\}}\);\n\n(?=test\()"
    next_source, count = re.subn(pattern, replacement.rstrip() + '\n\n', source, count=1)
    if count != 1:
        raise SystemExit(f'Expected exactly one legacy test named {name!r}, found {count}')
    source = next_source


replace_test(
    'category editor persists alignment and keyboard reorder',
    r'''test('unified menu edit persists one combined worker layout with keyboard and rollback', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const editButton = page.getByRole('button', { name: 'Edit menu' });
  await expect(editButton).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit categories' })).toHaveCount(0);

  await editButton.click();
  await expect(editButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Search menu' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Product families' })).toBeHidden();
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();

  const categories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(categories).toHaveCount(7);
  await expect(categories.nth(0)).toHaveText('Burgers');
  await expect(categories.nth(1)).toHaveText('Combo');

  const burgers = page.getByLabel('Menu categories').getByRole('button', {
    name: 'Burgers',
    exact: true,
  });
  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(burgers).toHaveClass(/category-tab-grabbed/);
  await expect(
    page.locator('.menu-pane .sr-only').filter({ hasText: 'Burgers picked up' }),
  ).toContainText('Burgers picked up');
  await page.keyboard.press('ArrowRight');
  await expect(categories.nth(0)).toHaveText('Combo');
  await page.keyboard.press('Escape');
  await expect(categories.nth(0)).toHaveText('Burgers');

  await burgers.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(categories.nth(0)).toHaveText('Combo');
  await expect(categories.nth(1)).toHaveText('Burgers');

  await page.getByRole('button', { name: 'Right', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Right', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  let reorderCards = page.locator('.menu-edit-product-card');
  await expect(reorderCards).toHaveCount(9);
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');
  await expect(reorderCards.nth(1)).toContainText('Double Smashed Patty');

  await reorderCards.nth(1).focus();
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(1)).toHaveClass(/menu-edit-product-card-grabbed/);
  await page.keyboard.press('ArrowLeft');
  await expect(reorderCards.nth(0)).toContainText('Double Smashed Patty');
  await page.keyboard.press('Escape');
  reorderCards = page.locator('.menu-edit-product-card');
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');

  await reorderCards.nth(1).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(0)).toContainText('Double Smashed Patty');

  expect(await categories.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toContain(
    'menu-edit-jiggle',
  );
  expect(await reorderCards.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toContain(
    'menu-edit-jiggle',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await categories.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toBe(
    'none',
  );
  expect(await reorderCards.nth(0).evaluate((node) => getComputedStyle(node).animationName)).toBe(
    'none',
  );
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('unified-menu-edit.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Menu layout saved' })).toBeVisible();

  let persistedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(persistedCategories.nth(0)).toHaveText('Combo');
  await expect(persistedCategories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  let menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.reload();
  await waitForActiveShell(page);
  persistedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(persistedCategories.nth(0)).toHaveText('Combo');
  await expect(persistedCategories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.getByRole('button', { name: 'Edit menu' }).click();
  reorderCards = page.locator('.menu-edit-product-card');
  await reorderCards.nth(0).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(reorderCards.nth(0)).toContainText('Single Smashed Patty');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Double Smashed Patty');

  await page.getByRole('button', { name: 'Edit menu' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const resetCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(resetCategories.nth(0)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'left');
  menuCards = page.locator('.product-grid .product-card');
  await expect(menuCards.nth(0)).toContainText('Single Smashed Patty');
});''',
)

replace_test(
    'category persistence failure keeps editor and draft intact',
    r'''test('unified menu edit persistence failure keeps the draft and order intact', async ({
  page,
}, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await expect(cart).toContainText('Single Smashed Patty');
  await closeMobileCartIfOpen(page, testInfo);

  const editButton = page.getByRole('button', { name: 'Edit menu' });
  await editButton.click();
  await page.getByRole('button', { name: 'Right', exact: true }).click();

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function forcedPreferenceWriteFailure(
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'workerUiPreferences') {
        throw new DOMException('Forced preference write failure', 'AbortError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });

  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not save menu layout. Try again.');
  await expect(editButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
  await openCartIfMobile(page, testInfo);
  await expect(currentOrderCart(page, testInfo)).toContainText('Single Smashed Patty');
});''',
)

replace_test(
    'worker product order editor persists keyboard reorder, cancel, and reset',
    r'''test('unified menu edit exposes no isolated product-order editor', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);
  await expect(page.getByRole('button', { name: 'Manage order' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit menu' }).click();
  await expect(page.getByRole('heading', { name: /Reordering Burgers/ })).toHaveCount(0);
  await expect(page.locator('.product-position-editor')).toHaveCount(0);
  await expect(page.locator('.menu-edit-product-card')).toHaveCount(9);
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
});''',
)

replace_test(
    'category edit contains primary categories only',
    r'''test('unified menu edit keeps primary categories and Product Cards in place', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Edit menu' }).click();

  await expect(page.getByPlaceholder('Search products')).toBeHidden();
  await expect(page.getByLabel('Product families')).toBeHidden();
  const primary = page.getByLabel('Menu categories').locator('.category-tab');
  const expectedPrimary = ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Zalabia', 'Extras', 'Drinks'];
  await expect(primary).toHaveCount(expectedPrimary.length);
  for (const [index, name] of expectedPrimary.entries()) {
    await expect(primary.nth(index)).toHaveText(name);
  }
  await expect(page.locator('.category-editor')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();
  await expect(page.locator('.menu-edit-product-card')).toHaveCount(9);
  await expect(page.getByLabel('Menu edit actions')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
});''',
)

legacy_visual = '''    await page.getByRole('button', { name: 'Edit categories' }).click();
    await expect(page.getByLabel('Edit categories')).toBeVisible();
    await screenshot('04-category-edit.png');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
'''
unified_visual = '''    await page.getByRole('button', { name: 'Edit menu' }).click();
    await expect(page.getByLabel('Menu edit actions')).toBeVisible();
    await expect(page.locator('.menu-edit-product-card').first()).toBeVisible();
    await screenshot('04-unified-menu-edit.png');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
'''
if legacy_visual not in source:
    raise SystemExit('Could not locate legacy visual-approval category editor block')
source = source.replace(legacy_visual, unified_visual, 1)

legacy_actions = '''  const actionButtons = page.locator('.category-nav-actions > button');
  await expect(actionButtons).toHaveCount(3);
  await expect(actionButtons.nth(0)).toHaveAccessibleName('Manage order');
  await expect(actionButtons.nth(1)).toHaveAccessibleName('Edit categories');
  await expect(actionButtons.nth(2)).toHaveAccessibleName('Search menu');
'''
unified_actions = '''  const actionButtons = page.locator('.category-nav-actions > button');
  await expect(actionButtons).toHaveCount(2);
  await expect(actionButtons.nth(0)).toHaveAccessibleName('Edit menu');
  await expect(actionButtons.nth(1)).toHaveAccessibleName('Search menu');
'''
if legacy_actions not in source:
    raise SystemExit('Could not locate legacy three-action header contract')
source = source.replace(legacy_actions, unified_actions, 1)

legacy_search_edit = "  await expect(page.getByRole('button', { name: 'Edit categories' })).toBeHidden();\n"
unified_search_edit = "  await expect(page.getByRole('button', { name: 'Edit menu' })).toBeHidden();\n"
if legacy_search_edit not in source:
    raise SystemExit('Could not locate legacy search/edit visibility assertion')
source = source.replace(legacy_search_edit, unified_search_edit, 1)

for required in [
    "name: 'Edit menu'",
    '.menu-edit-product-card',
    "name: 'Menu edit actions'",
    "reducedMotion: 'reduce'",
    "hasText: 'Menu layout saved'",
    "toHaveCount(2)",
]:
    if required not in source:
        raise SystemExit(f'Unified edit-mode rendered acceptance missing: {required}')

path.write_text(source)
