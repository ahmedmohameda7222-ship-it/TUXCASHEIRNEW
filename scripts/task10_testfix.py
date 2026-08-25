from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()

old = "test('Extra shortcuts preserve customized pricing and fresh adds', async ({ page }) => {"
new = "test('Extra shortcuts preserve customized pricing and fresh adds', async ({ page }, testInfo) => {"
if old not in text:
    raise SystemExit('Task 10 test signature anchor missing')
text = text.replace(old, new, 1)

old = "  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {\n    name: 'Current order',\n  });\n  const classicLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });"
new = "  await openCartIfMobile(page, testInfo);\n  const cart = currentOrderCart(page, testInfo);\n  const classicLines = cart.locator('.cart-line').filter({ hasText: 'Classic Smash' });"
if old not in text:
    raise SystemExit('Task 10 cart locator anchor missing')
text = text.replace(old, new, 1)

old = "  await expect(classicLines.nth(0)).toContainText(/200\\.00/);\n\n  await classicCard.getByRole('button', { name: 'Add one Classic Smash' }).click();\n  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('2');\n  await expect(classicLines).toHaveCount(2);"
new = "  await expect(classicLines.nth(0)).toContainText(/200\\.00/);\n\n  await closeMobileCartIfOpen(page, testInfo);\n  await classicCard.getByRole('button', { name: 'Add one Classic Smash' }).click();\n  await expect(classicCard.locator('.product-quantity-badge')).toHaveText('2');\n  await openCartIfMobile(page, testInfo);\n  await expect(classicLines).toHaveCount(2);"
if old not in text:
    raise SystemExit('Task 10 mobile cart transition anchor missing')
text = text.replace(old, new, 1)

path.write_text(text)
