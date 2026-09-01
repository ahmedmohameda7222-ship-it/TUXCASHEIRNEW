from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = """  const burgers = page.getByLabel('Menu categories').getByRole('button', {
    name: 'Burgers',
    exact: true,
  });
  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(burgers).toHaveClass(/category-tab-grabbed/);
"""
new = """  const burgers = categories.filter({ hasText: 'Burgers' }).first();
  await burgers.focus();
  await page.keyboard.press('Space');
  await expect(burgers).toHaveClass(/category-tab-grabbed/);
  await expect(burgers).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.category-tab.menu-edit-drag-overlay')).toHaveCount(1);
"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one hidden-category test anchor, found {count}')
path.write_text(text.replace(old, new, 1))
