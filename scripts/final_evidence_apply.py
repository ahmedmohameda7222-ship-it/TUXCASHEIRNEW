from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text().rstrip()
marker = "test('final correction approval evidence captures fixed eleven states'"
if marker not in text:
    text += r'''

test('final correction approval evidence captures fixed eleven states', async ({ page }, testInfo) => {
  async function startFresh(): Promise<void> {
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
    await expectNoHorizontalOverflow(page);
  }

  async function shot(name: string): Promise<void> {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `final-evidence/${name}`,
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  }

  const project = testInfo.project.name;
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  if (project === 'desktop-browser-fallback') {
    expect(viewport!.width).toBe(1440);
    await startFresh();
    await shot('01-1440-default-orders.png');

    await page.keyboard.press('Control+K');
    await expect(page.getByPlaceholder('Search products')).toBeFocused();
    await shot('02-1440-search-open.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Edit categories' }).click();
    await expect(page.getByLabel('Edit categories')).toBeVisible();
    await shot('03-1440-category-edit.png');
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    const described = page
      .locator('.product-card')
      .filter({ hasText: 'TUX Loaded Burger' })
      .first();
    await expect(described).toContainText(
      '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom',
    );
    await described.scrollIntoViewIfNeeded();
    await shot('04-1440-real-description-product.png');

    await startFresh();
    const classic = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
    await classic.getByRole('button', { name: 'Extra', exact: true }).click();
    const extras = page.getByRole('dialog', { name: 'Classic Smash' });
    await extras.getByRole('button', { name: 'Add one Extra Cheese' }).click();
    await shot('06-1440-extras-customizer.png');
    await extras.getByRole('button', { name: 'Add to Order', exact: true }).click();
    await page.getByRole('button', { name: 'Add one Double Smash' }).click();
    const mixedCart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await expect(mixedCart.getByRole('button', { name: '−1', exact: true }).first()).toBeVisible();
    await expect(mixedCart.getByRole('button', { name: '+1', exact: true }).first()).toBeVisible();
    await expect(mixedCart.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
    await expect(mixedCart.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
    await shot('07-1440-mixed-plain-customized-cart.png');

    await startFresh();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    await page.getByRole('button', { name: 'Add one TUX Loaded Burger' }).click();
    await page.getByRole('button', { name: 'Add one Spicy Chicken' }).click();
    await page.getByLabel('Menu categories').getByRole('button', { name: 'Drinks' }).click();
    await page.getByRole('button', { name: 'Add one Cola' }).click();
    let cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await cart.locator('.adjustment-disclosure').filter({ hasText: 'Discount' }).click();
    await cart.getByRole('textbox', { name: 'Discount' }).fill('95');
    await cart.getByRole('textbox', { name: 'Discount' }).blur();
    await expect(cart.locator('.grand-total')).toContainText('705.00');
    await cart.getByRole('button', { name: 'Cash', exact: true }).click();
    const cash = cart.getByLabel('Cash received');
    await expect(cash).toHaveValue('');
    await expect(cash).toHaveAttribute('placeholder', '0');
    const tenders = cart.getByLabel('Smart Cash tenders').getByRole('button');
    await expect(tenders).toHaveCount(5);
    for (const [index, amount] of ['705.00', '710.00', '720.00', '750.00', '800.00'].entries()) {
      await expect(tenders.nth(index)).toContainText(amount);
    }
    await shot('08-1440-single-cash.png');

    await startFresh();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await cart.getByRole('button', { name: 'Split payment' }).click();
    await cart.getByLabel('Amount A').fill('320');
    await cart.getByLabel('Amount A').blur();
    await expect(cart.getByLabel('Method A')).toBeVisible();
    await expect(cart.getByLabel('Method B')).toBeVisible();
    await expect(cart.locator('.split-remainder')).toContainText('80.00');
    await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
    await expect(cart.getByLabel('Cash received B')).toHaveCount(0);
    await shot('09-1440-split-payment.png');

    await startFresh();
    await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
    const rail = page.locator('.desktop-cart-wrap');
    const separator = page.getByRole('separator', { name: 'Resize Current Order' });
    const before = await rail.boundingBox();
    expect(before).not.toBeNull();
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    let after = await rail.boundingBox();
    expect(after).not.toBeNull();
    if (after!.width <= before!.width) {
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      after = await rail.boundingBox();
      expect(after).not.toBeNull();
    }
    expect(after!.width).toBeGreaterThan(before!.width);
    await shot('10-1440-resized-wider-rail.png');
    return;
  }

  if (project === 'mobile-tablet-browser-fallback') {
    expect(viewport!.width).toBe(768);
    await startFresh();
    const classic = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
    await expect(classic).toContainText(
      '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce',
    );
    await expect(classic.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
    await classic.scrollIntoViewIfNeeded();
    await shot('05-768-product-with-extras.png');
    return;
  }

  if (project === 'mobile-browser-fallback') {
    expect(viewport!.width).toBe(375);
    await startFresh();
    await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
    await page.getByRole('button', { name: /Review & pay/ }).click();
    await expect(page.locator('.mobile-cart-overlay')).toBeVisible();
    await shot('11-375-mobile-review-pay.png');
  }
});

test('final correction keyboard audit covers required controls', async ({ page }, testInfo) => {
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

  const edit = page.getByRole('button', { name: 'Edit categories' });
  const search = page.getByRole('button', { name: 'Search menu' });
  await edit.focus();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(edit).toBeFocused();

  await search.focus();
  await page.keyboard.press('Enter');
  let searchInput = page.getByPlaceholder('Search products');
  await expect(searchInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(searchInput).toHaveCount(0);

  await page.keyboard.press('Control+K');
  searchInput = page.getByPlaceholder('Search products');
  await expect(searchInput).toBeFocused();
  await searchInput.fill('smash');
  await page.keyboard.press('Escape');
  await expect(searchInput).toHaveValue('');
  await expect(searchInput).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search products')).toHaveCount(0);

  await page.keyboard.press('/');
  await expect(page.getByPlaceholder('Search products')).toBeFocused();
  await page.keyboard.press('Escape');

  await edit.focus();
  await page.keyboard.press('Space');
  const editor = page.getByLabel('Edit categories');
  await expect(editor).toBeVisible();
  const order = editor.getByRole('list', { name: 'Category order' }).getByRole('listitem');
  await expect(order.nth(0)).toContainText('Burgers');
  await expect(order.nth(1)).toContainText('Sides');
  const moveRight = editor.getByRole('button', { name: 'Move Burgers right' });
  await moveRight.focus();
  await page.keyboard.press('Enter');
  await expect(order.nth(0)).toContainText('Sides');
  await expect(order.nth(1)).toContainText('Burgers');
  await page.getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
});
'''
path.write_text(text + '\n')
