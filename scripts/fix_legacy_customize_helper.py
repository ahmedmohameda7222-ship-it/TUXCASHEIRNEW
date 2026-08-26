from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = '''async function addClassicWithModifier(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  await page.getByRole('button', { name: 'Customize & add' }).click();
  await page.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
}'''
new = '''async function addClassicWithModifier(page: Page): Promise<void> {
  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Extra', exact: true }).click();
  await page.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await page.getByRole('button', { name: 'Add to order' }).click();
}'''
if old not in text:
    raise SystemExit('legacy Customize & add helper not found')
path.write_text(text.replace(old, new, 1))
