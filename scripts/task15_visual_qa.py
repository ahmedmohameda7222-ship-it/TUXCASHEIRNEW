from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()


def replace_once(before: str, after: str) -> None:
    global text
    if after in text:
        return
    if before not in text:
        raise SystemExit(f'Expected E2E source block not found: {before[:120]!r}')
    text = text.replace(before, after, 1)


replace_once(
    """  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await waitForActiveShell(page);
  await expect(page.getByRole('img', { name: 'TUX' }).first()).toBeVisible();
""",
    """  await page.getByLabel('Enter PIN to Start Day').fill('1234');
  await page.getByRole('button', { name: 'Start Day' }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('.welcome-action') !== null ||
      document.querySelector('[aria-label=\"Operations\"]') !== null,
  );
  const welcomeAction = page.locator('.welcome-action');
  if (await welcomeAction.isVisible().catch(() => false)) await welcomeAction.click();
  await waitForActiveShell(page);
  await expect(page.getByRole('img', { name: 'TUX' }).first()).toBeVisible();
""",
)

replace_once(
    """test('category persistence failure keeps editor and draft intact', async ({ page }) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  const cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
    name: 'Current order',
  });
  await expect(cart).toContainText('Classic Smash');
""",
    """test('category persistence failure keeps editor and draft intact', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  await expect(cart).toContainText('Classic Smash');
  await closeMobileCartIfOpen(page, testInfo);
""",
)

replace_once(
    """  await expect(page.getByRole('alert')).toHaveText('Could not save category layout. Try again.');
  await expect(page.getByLabel('Edit categories')).toBeVisible();
  await expect(cart).toContainText('Classic Smash');
});
""",
    """  await expect(page.getByRole('alert')).toHaveText('Could not save category layout. Try again.');
  await expect(page.getByLabel('Edit categories')).toBeVisible();
  await openCartIfMobile(page, testInfo);
  await expect(currentOrderCart(page, testInfo)).toContainText('Classic Smash');
});
""",
)

replace_once(
    """  expect(cartTitleStyle.fontSize).toBe('17px');
  expect(cartTitleStyle.lineHeight).toBe('22px');
  expect(Number(cartTitleStyle.fontWeight)).toBe(600);

  const lineNameStyle = await cart
""",
    """  expect(cartTitleStyle.fontSize).toBe('17px');
  expect(cartTitleStyle.lineHeight).toBe('22px');
  expect(Number(cartTitleStyle.fontWeight)).toBe(600);

  const subsectionHeadingStyle = await cart
    .locator('.payment-section h2')
    .evaluate((node) => getComputedStyle(node));
  expect(subsectionHeadingStyle.fontSize).toBe('14px');
  expect(subsectionHeadingStyle.lineHeight).toBe('18px');
  expect(Number(subsectionHeadingStyle.fontWeight)).toBe(600);

  const lineNameStyle = await cart
""",
)

replace_once(
    """  const totalStyle = await cart
    .locator('.grand-total dd')
    .evaluate((node) => getComputedStyle(node));
  expect(totalStyle.fontSize).toBe('22px');
""",
    """  const totalLabelStyle = await cart
    .locator('.grand-total dt')
    .evaluate((node) => getComputedStyle(node));
  expect(totalLabelStyle.fontSize).toBe('18px');
  expect(totalLabelStyle.lineHeight).toBe('22px');
  expect(Number(totalLabelStyle.fontWeight)).toBe(600);

  const totalStyle = await cart
    .locator('.grand-total dd')
    .evaluate((node) => getComputedStyle(node));
  expect(totalStyle.fontSize).toBe('22px');
""",
)

marker = "test('visual approval evidence covers approved POS states'"
if marker not in text:
    text += r'''


test('visual approval evidence covers approved POS states', async ({ page }, testInfo) => {
  async function screenshot(name: string): Promise<void> {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  }

  async function startFresh(keepWelcome = false): Promise<void> {
    await seedBrowserFallback(page);
    await page.goto('/');
    await page.getByLabel('Enter PIN to Start Day').fill('1234');
    await page.getByRole('button', { name: 'Start Day' }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('.welcome-action') !== null ||
        document.querySelector('[aria-label="Operations"]') !== null,
    );
    const welcomeAction = page.locator('.welcome-action');
    if (keepWelcome) {
      await expect(welcomeAction).toBeVisible();
      return;
    }
    if (await welcomeAction.isVisible().catch(() => false)) await welcomeAction.click();
    await waitForActiveShell(page);
  }

  await startFresh(true);
  if (testInfo.project.name === 'desktop-browser-fallback') {
    await screenshot('01-welcome.png');
  }
  await page.locator('.welcome-action').click();
  await waitForActiveShell(page);
  await expectNoHorizontalOverflow(page);

  if (testInfo.project.name === 'desktop-browser-fallback') {
    await screenshot('02-default-orders.png');
    await captureVisualEvidence(page, testInfo);

    const navigation = page.getByRole('navigation', { name: 'Operations' });
    const navigationBox = await navigation.boundingBox();
    const viewport = page.viewportSize();
    expect(navigationBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(
      Math.abs(navigationBox!.x + navigationBox!.width / 2 - viewport!.width / 2),
    ).toBeLessThanOrEqual(2);

    await page.keyboard.press('Control+K');
    const searchInput = page.getByPlaceholder('Search products');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();
    await screenshot('03-expanded-search.png');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Edit categories' }).click();
    await expect(page.getByLabel('Edit categories')).toBeVisible();
    await screenshot('04-category-edit.png');
    await page.getByRole('button', { name: 'Done', exact: true }).click();

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
    const tenders = cart.getByLabel('Smart Cash tenders').getByRole('button');
    await expect(tenders).toHaveCount(5);
    await expect(tenders.nth(0)).toContainText('705.00');
    await expect(tenders.nth(1)).toContainText('710.00');
    await expect(tenders.nth(2)).toContainText('720.00');
    await expect(tenders.nth(3)).toContainText('750.00');
    await expect(tenders.nth(4)).toContainText('800.00');
    const cashReceived = cart.getByLabel('Cash received');
    await expect(cashReceived).toHaveValue('');
    await screenshot('05-single-cash-705.png');
    await cashReceived.fill('800');
    await cashReceived.blur();
    await expect(cart.locator('.payment-summary')).toContainText('Change: EGP 95.00');

    await startFresh();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    await page.getByRole('button', { name: 'Add one Triple Smash' }).click();
    cart = page.locator('.desktop-cart-wrap').getByRole('complementary', {
      name: 'Current order',
    });
    await cart.getByRole('button', { name: 'Split payment' }).click();
    await cart.getByLabel('Amount A').fill('320');
    await cart.getByLabel('Amount A').blur();
    await expect(cart.locator('.split-remainder')).toContainText('80.00');
    await expect(cart.getByLabel('Cash received A')).toHaveCount(0);
    await expect(cart.getByLabel('Cash received B')).toHaveCount(0);
    await screenshot('06-split-payment-400.png');

    await startFresh();
    const classicCard = page.locator('.product-card').filter({ hasText: 'Classic Smash' }).first();
    await classicCard.getByRole('button', { name: 'Extra', exact: true }).click();
    const extrasDialog = page.getByRole('dialog', { name: 'Classic Smash' });
    await extrasDialog.getByRole('button', { name: 'Add one Extra Cheese' }).click();
    await extrasDialog.getByRole('button', { name: 'Add one Extra Patty' }).click();
    await screenshot('07-extras-customizer.png');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transitionDurations = await page
      .locator('.product-card')
      .first()
      .evaluate((node) =>
        getComputedStyle(node)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value)),
      );
    expect(transitionDurations.every((duration) => duration <= 0.001)).toBe(true);
    return;
  }

  await page.getByRole('button', { name: 'Add one Classic Smash' }).click();
  await openCartIfMobile(page, testInfo);
  await expect(page.locator('.mobile-cart-overlay')).toBeVisible();
  if (testInfo.project.name === 'mobile-browser-fallback') {
    await screenshot('08-mobile-review-pay.png');
  } else {
    await screenshot('09-tablet-review-pay.png');
  }
});
'''
path.write_text(text)
