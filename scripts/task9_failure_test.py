from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
marker = "test('category persistence failure keeps editor and draft intact'"
if marker not in text:
    text += """


test('category persistence failure keeps editor and draft intact', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  await expect(cart).toContainText('Classic Smash');

  await page.getByRole('button', { name: 'Edit categories' }).click();
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

  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByRole('alert')).toHaveText('Could not save category layout. Try again.');
  await expect(page.getByLabel('Edit categories')).toBeVisible();
  await expect(cart).toContainText('Classic Smash');
});
"""
path.write_text(text)
