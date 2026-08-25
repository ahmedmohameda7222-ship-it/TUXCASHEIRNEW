from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
text = text.replace(
    "await cart.getByLabel('Discount').fill('39');\n  await cart.getByLabel('Discount').blur();",
    "await cart.getByRole('textbox', { name: 'Discount' }).fill('39');\n  await cart.getByRole('textbox', { name: 'Discount' }).blur();",
)
marker = "test('Cash entry stays optional and split stays allocation-only'"
if marker not in text:
    text += r'''


test('Cash entry stays optional and split stays allocation-only', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Double Smash' }).click();
  await openCartIfMobile(page, testInfo);
  let cart = currentOrderCart(page, testInfo);

  await cart.locator('.adjustment-disclosure').filter({ hasText: 'Discount' }).click();
  await cart.getByRole('textbox', { name: 'Discount' }).fill('39');
  await cart.getByRole('textbox', { name: 'Discount' }).blur();
  await expect(cart.locator('.grand-total')).toContainText('121.00');

  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cashReceived = cart.getByLabel('Cash received');
  await expect(cashReceived).toHaveValue('');
  await expect(cashReceived).toHaveAttribute('placeholder', '0');

  const tenders = cart.getByLabel('Smart Cash tenders').getByRole('button');
  await expect(tenders).toHaveCount(5);
  await expect(tenders.nth(0)).toContainText('121.00');
  await expect(tenders.nth(4)).toContainText('200.00');

  await cashReceived.fill('');
  await cashReceived.blur();
  await expect(cashReceived).toHaveValue('');
  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
  await closeMobileCartIfOpen(page, testInfo);

  await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
  await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
  await openCartIfMobile(page, testInfo);
  cart = currentOrderCart(page, testInfo);

  await cart.getByRole('button', { name: 'Split payment' }).click();
  await cart.getByLabel('Amount A').fill('320');
  await cart.getByLabel('Amount A').blur();
  await expect(cart.locator('.split-remainder')).toContainText('80.00');
  await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
  await expect(cart.getByLabel('Cash received B')).toHaveCount(0);

  await cart.getByRole('button', { name: 'Place Order' }).click();
  await expectOrderPlaced(page);
});
'''
path.write_text(text)
