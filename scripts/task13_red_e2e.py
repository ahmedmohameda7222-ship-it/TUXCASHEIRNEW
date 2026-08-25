from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
marker = "test('resize Current Order rail persists device-local width'"
if marker not in text:
    text += r'''


test('resize Current Order rail persists device-local width', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const separator = page.getByRole('separator', { name: 'Resize Current Order' });
  if (!testInfo.project.name.startsWith('desktop')) {
    await expect(separator).toHaveCount(0);
    return;
  }

  await expect(separator).toBeVisible();
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');

  const cart = page.locator('.desktop-cart-wrap');
  const menu = page.locator('.menu-pane');
  const initialCart = await cart.boundingBox();
  const initialMenu = await menu.boundingBox();
  expect(initialCart).not.toBeNull();
  expect(initialMenu).not.toBeNull();
  expect(Math.abs(initialCart!.width - 432)).toBeLessThanOrEqual(2);

  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await cart.boundingBox())?.width ?? 0).toBeGreaterThan(initialCart!.width);
  const keyboardCart = await cart.boundingBox();
  const keyboardMenu = await menu.boundingBox();
  expect(keyboardCart).not.toBeNull();
  expect(keyboardMenu).not.toBeNull();
  expect(keyboardMenu!.width).toBeLessThan(initialMenu!.width);

  const handleBox = await separator.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x - 48, handleBox!.y + handleBox!.height / 2, { steps: 4 });
  await page.mouse.up();

  const resizedCart = await cart.boundingBox();
  expect(resizedCart).not.toBeNull();
  expect(resizedCart!.width).toBeGreaterThan(keyboardCart!.width);
  expect(resizedCart!.width).toBeLessThanOrEqual(600);
  await expectNoHorizontalOverflow(page);

  const persisted = await page.evaluate(() => localStorage.getItem('tux.operations.currentOrderWidth'));
  expect(persisted).not.toBeNull();
  expect(Number(persisted)).toBeCloseTo(resizedCart!.width, 0);

  await page.reload();
  await waitForActiveShell(page);
  const reloadedCart = page.locator('.desktop-cart-wrap');
  await expect.poll(async () => (await reloadedCart.boundingBox())?.width ?? 0).toBeCloseTo(Number(persisted), 0);

  await page.setViewportSize({ width: 1000, height: 960 });
  await expect.poll(async () => (await reloadedCart.boundingBox())?.width ?? 0).toBeCloseTo(450, 0);
  await expectNoHorizontalOverflow(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('tux.operations.currentOrderWidth'))).toBe('450');
});
'''
path.write_text(text)
