from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('keyboard-only category controls support traversal activation and reorder'"
if marker not in text:
    text += r'''

test('keyboard-only category controls support traversal activation and reorder', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrdersForCategoryTests(page);

  const editButton = page.getByRole('button', { name: 'Edit categories' });
  const searchButton = page.getByRole('button', { name: 'Search menu' });

  await editButton.focus();
  await expect(editButton).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(searchButton).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(editButton).toBeFocused();

  await page.keyboard.press('Enter');
  const editor = page.getByLabel('Edit categories');
  await expect(editor).toBeVisible();
  const items = editor.locator('.category-editor-item');
  await expect(items.nth(0)).toContainText('Burgers');

  const moveRight = page.getByRole('button', { name: 'Move Burgers right' });
  await moveRight.focus();
  await page.keyboard.press('Enter');
  await expect(items.nth(0)).toContainText('Sides');
  await expect(items.nth(1)).toContainText('Burgers');

  const moveLeft = page.getByRole('button', { name: 'Move Burgers left' });
  await moveLeft.focus();
  await page.keyboard.press('Space');
  await expect(items.nth(0)).toContainText('Burgers');
  await expect(items.nth(1)).toContainText('Sides');
});
'''
path.write_text(text + '\n')
