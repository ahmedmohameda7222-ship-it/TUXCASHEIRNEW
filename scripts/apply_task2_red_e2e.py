from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('approved category hierarchy stays two-level across idle search and edit'"
if marker in text:
    raise SystemExit('Task 2 RED tests already present')

text += r'''

test('approved category hierarchy stays two-level across idle search and edit', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  const primary = page.getByLabel('Menu categories').locator('.category-tab');
  const expectedPrimary = ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Zalabia', 'Extras', 'Drinks'];
  await expect(primary).toHaveCount(expectedPrimary.length);
  for (const [index, name] of expectedPrimary.entries()) {
    await expect(primary.nth(index)).toHaveText(name);
  }
  await expect(primary.nth(0)).toHaveClass(/selected/);
  await expect(
    page.getByLabel('Menu categories').getByRole('button', { name: 'All', exact: true }),
  ).toHaveCount(0);

  const families = page.getByLabel('Product families').getByRole('button');
  await expect(families).toHaveCount(3);
  await expect(families.nth(0)).toHaveText('All');
  await expect(families.nth(1)).toHaveText('TUX');
  await expect(families.nth(2)).toHaveText('TUXIFY');
});

test('search keeps both category levels visible and hides edit chrome', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Search menu' }).click();

  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible();
  await expect(page.getByLabel('Menu categories').locator('.category-tab')).toHaveCount(7);
  await expect(page.getByLabel('Product families')).toBeVisible();
  await expect(page.getByPlaceholder('Search products')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit categories' })).toBeHidden();
  await expect(page.getByText('Ctrl K', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible();
});

test('category edit contains primary categories only', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Edit categories' }).click();

  await expect(page.getByPlaceholder('Search products')).toBeHidden();
  await expect(page.getByLabel('Product families')).toBeHidden();
  const editor = page.locator('.category-editor');
  const items = editor.locator('.category-editor-item');
  const expectedPrimary = ['Burgers', 'Combo', 'Fries', 'Hawawshi', 'Zalabia', 'Extras', 'Drinks'];
  await expect(items).toHaveCount(expectedPrimary.length);
  for (const [index, name] of expectedPrimary.entries()) {
    await expect(items.nth(index)).toContainText(name);
  }
  await expect(editor.getByText('All', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('TUX', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('TUXIFY', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Category alignment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
});
'''

path.write_text(text + '\n')
