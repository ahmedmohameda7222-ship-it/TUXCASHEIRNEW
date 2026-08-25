from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('final correction approval evidence enforces primary category contract'"
if marker not in text:
    text += r'''

test('final correction approval evidence enforces primary category contract', async ({ page }, testInfo) => {
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

  const tabs = page.getByLabel('Menu categories').getByRole('button');
  await expect(tabs.nth(0)).toHaveText('All');
  await expect(tabs.nth(1)).toHaveText('TUX');
  await expect(tabs.nth(2)).toHaveText('TUXIFY');
  await expect(page.getByRole('navigation', { name: 'Operations' })).toBeVisible();
});
'''
path.write_text(text + '\n')
