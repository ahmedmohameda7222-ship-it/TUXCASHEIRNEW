from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()

cheese_anchor = "    ['TUX Hawawshi', 4_000, 1, false, false],\n  ].map(([name, priceMinor, categoryIndex, isCombo, soldOut], index) => ({"
cheese_replacement = "    ['TUX Hawawshi', 4_000, 1, false, false],\n    ['Cheese Fries', 3_000, 2, false, false],\n  ].map(([name, priceMinor, categoryIndex, isCombo, soldOut], index) => ({"
if cheese_replacement not in text:
    if cheese_anchor not in text:
        raise SystemExit('Expected TUX Hawawshi fixture anchor was not found')
    text = text.replace(cheese_anchor, cheese_replacement, 1)

marker = "test('final correction approval evidence enforces exact approved menu content'"
if marker not in text:
    text = text.rstrip() + r'''

test('final correction approval evidence enforces exact approved menu content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await seedBrowserFallback(page);
  await page.goto('/');
  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.welcome-action') !== null ||
      document.querySelector('[aria-label="Operations"]') !== null,
  );
  const welcome = page.locator('.welcome-action');
  if (await welcome.isVisible().catch(() => false)) await welcome.click();
  await waitForActiveShell(page);

  const expectedDescriptions = new Map<string, string>([
    ['Single Smashed Patty', '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'],
    ['Double Smashed Patty', '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'],
    ['Triple Smashed Patty', '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'],
    ['TUX Quatro Smashed Patty', '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'],
    ['Single TUXIFY', 'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'],
    ['Double TUXIFY', 'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'],
    ['Triple TUXIFY', 'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'],
    ['Quatro TUXIFY', 'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'],
    ['Chili Fries', 'Fries, cheese, chili sauce, jalapeno'],
    ['TUX Fries', 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'],
    ['Doppy Fries', 'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion'],
    ['Johnny’s', '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges'],
    ['Classic Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce'],
    ['TUX Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella'],
  ]);
  const withoutDescriptions = ['Classic Fries', 'Potato Wedges', 'Cheese Fries', 'Soda', 'Water'];
  const allNames = [...expectedDescriptions.keys(), ...withoutDescriptions];

  await expect(page.locator('.product-card')).toHaveCount(19);
  for (const name of allNames) {
    const card = page
      .locator('.product-card')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first();
    await expect(card).toBeVisible();
    const description = expectedDescriptions.get(name);
    if (description === undefined) {
      await expect(card.locator('.product-copy p')).toHaveCount(0);
    } else {
      await expect(card.locator('.product-copy p')).toHaveText(description);
    }
  }
});
'''

path.write_text(text.rstrip() + '\n')
