from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
marker = "test('Extra shortcuts preserve customized pricing and fresh adds'"
if marker not in text:
    text += r'''


test('Extra shortcuts preserve customized pricing and fresh adds', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  const classicCard = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
  const doubleCard = page.locator('.product-card').filter({ hasText: 'Double Smash' }).first();
  await expect(classicCard.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
  await expect(doubleCard.getByRole('button', { name: 'Extra', exact: true })).toHaveCount(0);

  await classicCard.getByRole('button', { name: 'Extra', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  const addExtrasSection = addDialog.locator('[aria-labelledby="extras-title"]');
  await expect(addExtrasSection).toBeFocused();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await addDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await addDialog.getByRole('button', { name: 'Add to order' }).click();

  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('1');
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  const classicLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(classicLines).toHaveCount(1);
  await expect(classicLines.nth(0)).toContainText('2× Extra Cheese');
  await expect(classicLines.nth(0)).toContainText('1× Extra Patty');
  await expect(classicLines.nth(0)).toContainText(/200\.00/);

  await classicCard.getByRole('button', { name: 'Add one Classic Smash' }).click();
  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('2');
  await expect(classicLines).toHaveCount(2);
  await expect(classicLines.nth(1)).not.toContainText('Extra Cheese');
  await expect(classicLines.nth(1)).not.toContainText('Extra Patty');
  await expect(classicLines.nth(1)).toContainText(/120\.00/);

  await classicLines.nth(0).getByRole('button', { name: 'Extra', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  await expect(editDialog.locator('[aria-labelledby="extras-title"]')).toBeFocused();
  await editDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
  await editDialog.getByRole('button', { name: 'Save item' }).click();

  const updatedLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(updatedLines).toHaveCount(2);
  await expect(updatedLines.nth(0)).toContainText('2× Extra Patty');
  await expect(updatedLines.nth(0)).toContainText(/240\.00/);
  await expect(updatedLines.nth(1)).not.toContainText('Extra Patty');
});
'''
path.write_text(text)
