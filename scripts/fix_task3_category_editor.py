from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = '''  const editorItems = page.locator('.category-editor-item');
  await expect(editorItems).toHaveCount(3);
  await expect(editorItems.nth(0)).toContainText('Burgers');
  await page.getByRole('button', { name: 'Move Burgers right' }).click();
  await expect(editorItems.nth(0)).toContainText('Sides');
  await expect(editorItems.nth(1)).toContainText('Burgers');

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const categories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(categories.nth(0)).toHaveText('Sides');
  await expect(categories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');

  await page.reload();
  await waitForActiveShell(page);
  const reloadedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(reloadedCategories.nth(0)).toHaveText('Sides');
  await expect(reloadedCategories.nth(1)).toHaveText('Burgers');
'''
new = '''  const editorItems = page.locator('.category-editor-item');
  await expect(editorItems).toHaveCount(7);
  await expect(editorItems.nth(0)).toContainText('Burgers');
  await page.getByRole('button', { name: 'Move Burgers right' }).click();
  await expect(editorItems.nth(0)).toContainText('Combo');
  await expect(editorItems.nth(1)).toContainText('Burgers');

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const categories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(categories).toHaveCount(7);
  await expect(categories.nth(0)).toHaveText('Combo');
  await expect(categories.nth(1)).toHaveText('Burgers');
  await expect(page.getByLabel('Menu categories')).toHaveAttribute('data-alignment', 'right');

  await page.reload();
  await waitForActiveShell(page);
  const reloadedCategories = page.getByLabel('Menu categories').locator('.category-tab');
  await expect(reloadedCategories).toHaveCount(7);
  await expect(reloadedCategories.nth(0)).toHaveText('Combo');
  await expect(reloadedCategories.nth(1)).toHaveText('Burgers');
'''
if old not in text:
    raise SystemExit('Expected legacy three-category editor assertion block not found')
path.write_text(text.replace(old, new, 1))
