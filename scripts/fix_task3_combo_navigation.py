from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
old = """async function placeSplitComboOrder(page: Page, testInfo: TestInfo): Promise<void> {
  await page.getByRole('button', { name: 'Add one Combo Smash + Required Beverage' }).click();
"""
new = """async function placeSplitComboOrder(page: Page, testInfo: TestInfo): Promise<void> {
  await page
    .getByLabel('Menu categories')
    .getByRole('button', { name: 'Combo', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add one Combo Smash + Required Beverage' }).click();
"""
if old not in text:
    raise SystemExit('Expected combo-order helper fragment not found')
path.write_text(text.replace(old, new, 1))
