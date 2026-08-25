from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('final correction approval evidence enforces numeric geometry'"
if marker not in text:
    text += r'''

test('final correction approval evidence enforces numeric geometry', async ({ page }, testInfo) => {
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

  const px = async (locator: Locator, property: string) =>
    locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(String(name)), property);

  const header = page.locator('.operations-header');
  const headerBox = await header.boundingBox();
  expect(headerBox?.height).toBe(64);
  expect(await px(header, 'padding-left')).toBe('16px');
  expect(await px(header, 'padding-right')).toBe('16px');
  const brandBox = await header.locator('.tux-brand').boundingBox();
  expect(brandBox?.height).toBe(44);
  const navItem = header.locator('.nav-item').first();
  expect(await px(navItem, 'font-size')).toBe('15px');
  expect(await px(navItem, 'line-height')).toBe('20px');
  expect(await px(navItem, 'min-height')).toBe('44px');

  const toolbar = page.locator('.menu-toolbar');
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox?.height).toBe(56);
  const rail = page.getByLabel('Menu categories');
  expect(await px(rail, 'gap')).toBe('6px');
  const allTab = rail.getByRole('button', { name: 'All', exact: true });
  const allBox = await allTab.boundingBox();
  expect(allBox?.height).toBe(44);
  expect(await px(allTab, 'padding-left')).toBe('16px');
  expect(await px(allTab, 'font-size')).toBe('15px');
  expect(await px(allTab, 'line-height')).toBe('20px');

  const grid = page.locator('.product-grid');
  expect(await px(grid, 'row-gap')).toBe('8px');
  expect(await px(grid, 'column-gap')).toBe('8px');
  const product = page.locator('.product-card').first();
  expect(await px(product, 'border-radius')).toBe('12px');
  const mediaBox = await product.locator('.product-media').boundingBox();
  expect(mediaBox?.width).toBe(68);
  expect(mediaBox?.height).toBe(68);
  const main = product.locator('.product-main');
  expect(await px(main, 'padding-top')).toBe('12px');
  expect(await px(main, 'padding-right')).toBe('12px');
  expect(await px(product, 'min-height')).toBe('152px');

  const noDescription = page.locator('.product-card').filter({ hasText: 'Soda' }).first();
  expect(await px(noDescription, 'min-height')).toBe('0px');

  const fallback = product.locator('.product-image-fallback');
  expect(await px(fallback, 'font-size')).toBe('13px');
  expect(await px(fallback, 'line-height')).toBe('16px');

  const extra = product.getByRole('button', { name: 'Extra', exact: true });
  const extraBox = await extra.boundingBox();
  expect(extraBox?.height).toBe(44);
  expect(await px(extra, 'font-size')).toBe('14px');
  expect(await px(extra, 'line-height')).toBe('18px');
  const extraIcon = extra.locator('svg');
  const extraIconBox = await extraIcon.boundingBox();
  expect(extraIconBox?.width).toBe(20);
  expect(extraIconBox?.height).toBe(20);

  await product.getByRole('button', { name: /Add one/ }).click();
  const stepper = product.locator('.product-quantity');
  const stepperBox = await stepper.boundingBox();
  expect(stepperBox?.height).toBe(44);
  for (const button of await stepper.locator('button').all()) {
    const box = await button.boundingBox();
    expect(box?.width).toBe(44);
    expect(box?.height).toBe(44);
  }
  const quantity = stepper.locator('output');
  expect(await px(quantity, 'font-size')).toBe('15px');
  expect(await px(quantity, 'line-height')).toBe('20px');
  const badge = product.locator('.product-quantity-badge');
  const badgeBox = await badge.boundingBox();
  expect(badgeBox?.width).toBeGreaterThanOrEqual(24);
  expect(badgeBox?.height).toBe(24);
  expect(await px(badge, 'font-size')).toBe('13px');
  expect(await px(badge, 'line-height')).toBe('16px');

  const cart = page.locator('.desktop-cart-wrap');
  const cartBox = await cart.boundingBox();
  expect(cartBox?.width).toBe(432);
  const resize = page.getByRole('separator', { name: 'Resize Current Order' });
  const resizeBox = await resize.boundingBox();
  expect(resizeBox?.width).toBeGreaterThanOrEqual(10);
  expect(resizeBox?.width).toBeLessThanOrEqual(12);
  await expect(resize).toHaveAttribute('aria-valuemin', '360');
  await expect(resize).toHaveAttribute('aria-valuemax', '600');
  await expect(resize).toHaveAttribute('aria-valuenow', '432');
});
'''
path.write_text(text + '\n')
