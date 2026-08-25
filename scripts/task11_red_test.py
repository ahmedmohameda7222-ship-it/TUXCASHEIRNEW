from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
marker = "test('Current Order keeps cashier controls attached to each line'"
if marker not in text:
    text += r'''


test('Current Order keeps cashier controls attached to each line', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await addClassicWithModifier(page);
  await openCartIfMobile(page, testInfo);

  const cart = currentOrderCart(page, testInfo);
  const sectionTitles = await cart
    .locator('.cart-section > h2, .cart-section .section-heading-row > h2')
    .allTextContents();
  expect(sectionTitles.slice(0, 4)).toEqual(['Items', 'Order type', 'Notes & discount', 'Payment']);

  const title = cart.locator('.cart-title');
  const count = cart.locator('.cart-count');
  await expect(title).toHaveText('Current Order');
  await expect(count).toHaveText('1 item');
  expect(await title.evaluate((node) => getComputedStyle(node).fontSize)).toBe('17px');
  expect(await title.evaluate((node) => getComputedStyle(node).lineHeight)).toBe('22px');
  expect(await count.evaluate((node) => getComputedStyle(node).fontSize)).toBe('13px');
  expect(await count.evaluate((node) => getComputedStyle(node).lineHeight)).toBe('16px');

  const lines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });
  await expect(lines).toHaveCount(1);
  const line = lines.first();
  await expect(line).toContainText('1× Extra Cheese');
  await expect(line.getByRole('button', { name: '−1', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: '+1', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(line.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();

  await line.getByRole('button', { name: '+1', exact: true }).click();
  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText('× 2');
  await expect(lines.first()).toContainText('1× Extra Cheese');

  await lines.first().getByRole('button', { name: '−1', exact: true }).click();
  await expect(lines.first()).toContainText('× 1');
  await expect(page.getByRole('status')).toContainText('Removed one Classic Smash');

  await lines.first().getByRole('button', { name: 'Edit', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Classic Smash' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText('Extra Cheese')).toBeVisible();
  await editDialog.getByRole('button', { name: 'Cancel' }).click();

  const cartDisplay = await cart.evaluate((node) => getComputedStyle(node).display);
  expect(cartDisplay).toBe('grid');
  const cartScroll = cart.locator('.cart-scroll');
  const totals = cart.locator('.cart-totals');
  const [scrollBox, totalsBox] = await Promise.all([cartScroll.boundingBox(), totals.boundingBox()]);
  expect(scrollBox).not.toBeNull();
  expect(totalsBox).not.toBeNull();
  expect(scrollBox!.y + scrollBox!.height).toBeLessThanOrEqual(totalsBox!.y + 1);
});
'''
path.write_text(text)
