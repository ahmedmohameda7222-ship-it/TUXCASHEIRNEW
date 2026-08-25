from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()
marker = "test('premium POS visual hierarchy matches approved sizing'"
if marker not in text:
    text += r'''


test('premium POS visual hierarchy matches approved sizing', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);
  await expectNoHorizontalOverflow(page);

  if (!testInfo.project.name.startsWith('desktop')) return;

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const nav = page.getByRole('navigation', { name: 'Operations' });
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(Math.abs(navBox!.x + navBox!.width / 2 - viewport!.width / 2)).toBeLessThanOrEqual(2);

  const activeNav = page.getByRole('button', { name: 'Orders', exact: true });
  const inactiveNav = page.getByRole('button', { name: 'Orders Board', exact: true });
  const activeNavStyle = await activeNav.evaluate((node) => getComputedStyle(node));
  const inactiveNavStyle = await inactiveNav.evaluate((node) => getComputedStyle(node));
  expect(activeNavStyle.fontSize).toBe('15px');
  expect(activeNavStyle.lineHeight).toBe('20px');
  expect(Number(activeNavStyle.fontWeight)).toBe(600);
  expect(inactiveNavStyle.fontSize).toBe('15px');
  expect(inactiveNavStyle.lineHeight).toBe('20px');
  expect(Number(inactiveNavStyle.fontWeight)).toBe(500);
  expect((await activeNav.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const categories = page.getByLabel('Menu categories');
  const activeCategory = categories.getByRole('button', { name: 'Burgers', exact: true });
  const inactiveCategory = categories.getByRole('button', { name: 'Sides', exact: true });
  const activeCategoryStyle = await activeCategory.evaluate((node) => getComputedStyle(node));
  const inactiveCategoryStyle = await inactiveCategory.evaluate((node) => getComputedStyle(node));
  expect(activeCategoryStyle.fontSize).toBe('15px');
  expect(activeCategoryStyle.lineHeight).toBe('20px');
  expect(Number(activeCategoryStyle.fontWeight)).toBe(600);
  expect(Number(inactiveCategoryStyle.fontWeight)).toBe(500);
  expect((await activeCategory.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const stressCard = page
    .locator('.product-card')
    .filter({ hasText: 'Long Name Layout Stress Burger with Extra Description' })
    .first();
  const productName = stressCard.locator('.product-copy strong');
  const productDescription = stressCard.locator('.product-copy p');
  const productNameStyle = await productName.evaluate((node) => getComputedStyle(node));
  const productDescriptionStyle = await productDescription.evaluate((node) => getComputedStyle(node));
  expect(productNameStyle.fontSize).toBe('15px');
  expect(productNameStyle.lineHeight).toBe('20px');
  expect(Number(productNameStyle.fontWeight)).toBe(600);
  expect(productDescriptionStyle.fontSize).toBe('14px');
  expect(productDescriptionStyle.lineHeight).toBe('18px');
  expect(Number(productDescriptionStyle.fontWeight)).toBe(400);
  expect(productDescriptionStyle.webkitLineClamp).toBe('2');
  await expect(productDescription).toHaveText(
    'Development-only long text used to stress responsive menu layout.',
  );
  expect(
    (await stressCard.locator('.product-price').evaluate((node) => getComputedStyle(node)))
      .fontVariantNumeric,
  ).toContain('tabular-nums');

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  const cartTitleStyle = await cart.locator('.cart-title').evaluate((node) => getComputedStyle(node));
  expect(cartTitleStyle.fontSize).toBe('17px');
  expect(cartTitleStyle.lineHeight).toBe('22px');
  expect(Number(cartTitleStyle.fontWeight)).toBe(600);

  const lineNameStyle = await cart
    .locator('.cart-line-top strong')
    .first()
    .evaluate((node) => getComputedStyle(node));
  expect(lineNameStyle.fontSize).toBe('15px');
  expect(lineNameStyle.lineHeight).toBe('20px');
  expect(Number(lineNameStyle.fontWeight)).toBe(600);

  await cart.getByRole('button', { name: 'Cash', exact: true }).click();
  const cashInputStyle = await cart.getByLabel('Cash received').evaluate((node) => getComputedStyle(node));
  expect(cashInputStyle.fontSize).toBe('14px');
  expect(cashInputStyle.lineHeight).toBe('18px');
  expect(Number(cashInputStyle.fontWeight)).toBe(400);
  expect(cashInputStyle.fontVariantNumeric).toContain('tabular-nums');

  const totalStyle = await cart.locator('.grand-total dd').evaluate((node) => getComputedStyle(node));
  expect(totalStyle.fontSize).toBe('22px');
  expect(totalStyle.lineHeight).toBe('26px');
  expect(Number(totalStyle.fontWeight)).toBe(700);
  expect(totalStyle.fontVariantNumeric).toContain('tabular-nums');

  const placeOrder = cart.getByRole('button', { name: 'Place Order' });
  const placeOrderBox = await placeOrder.boundingBox();
  const placeOrderStyle = await placeOrder.evaluate((node) => getComputedStyle(node));
  expect(placeOrderBox).not.toBeNull();
  expect(placeOrderBox!.height).toBeGreaterThanOrEqual(48);
  expect(placeOrderStyle.fontSize).toBe('16px');
  expect(placeOrderStyle.lineHeight).toBe('20px');
  expect(Number(placeOrderStyle.fontWeight)).toBe(600);
});
'''
path.write_text(text)
