import { expect, test, type Locator, type Page } from '@playwright/test';

async function mountCashierStyleFixture(page: Page): Promise<Locator> {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#apple-hig-remediation-fixture')?.remove();

    const fixture = document.createElement('section');
    fixture.id = 'apple-hig-remediation-fixture';
    fixture.innerHTML = `
      <div class="order-type-section">
        <div class="segmented-control">
          <button type="button">Take Away</button>
          <button type="button">Dine In</button>
          <button type="button" class="selected">Delivery</button>
        </div>
      </div>
      <div class="payment-section">
        <div class="payment-methods">
          <button type="button" class="selected">Cash</button>
          <button type="button">Instapay</button>
        </div>
      </div>
      <div class="line-actions">
        <div class="line-quantity-stepper quantity-control">
          <button type="button" class="quantity-decrement" aria-label="Decrease Fixture quantity">−</button>
          <output>1</output>
          <button type="button" class="quantity-increment" aria-label="Increase Fixture quantity">+</button>
        </div>
        <button type="button">Edit</button>
        <button type="button">Extra</button>
      </div>
      <article class="product-card">
        <footer class="product-card-footer">
          <button type="button" class="product-extra-action">Extra</button>
          <div class="product-card-controls">
            <div class="product-quantity">
              <button type="button" class="quantity-decrement" aria-label="Remove one Fixture">−</button>
              <output>1</output>
              <button type="button" class="quantity-increment" aria-label="Add one Fixture">+</button>
            </div>
          </div>
        </footer>
      </article>
    `;
    document.body.appendChild(fixture);
  });

  return page.locator('#apple-hig-remediation-fixture');
}

async function expectSemibold(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS('font-weight', '600');
}

test('cashier-critical controls render with approved operational emphasis', async ({ page }) => {
  const fixture = await mountCashierStyleFixture(page);

  for (const name of ['Take Away', 'Dine In', 'Delivery']) {
    await expectSemibold(fixture.locator('.order-type-section').getByRole('button', { name, exact: true }));
  }
  for (const name of ['Cash', 'Instapay']) {
    await expectSemibold(fixture.locator('.payment-section').getByRole('button', { name, exact: true }));
  }

  const lineActions = fixture.locator('.line-actions');
  await expectSemibold(lineActions.getByRole('button', { name: 'Edit', exact: true }));
  await expectSemibold(lineActions.getByRole('button', { name: 'Extra', exact: true }));
  await expectSemibold(
    fixture.locator('.product-card').getByRole('button', { name: 'Extra', exact: true }),
  );
});

test('quantity increment is action-colored while decrement stays neutral', async ({ page }) => {
  const fixture = await mountCashierStyleFixture(page);

  for (const selector of ['.product-quantity', '.line-quantity-stepper']) {
    const stepper = fixture.locator(selector);
    const increment = stepper.locator('.quantity-increment');
    const decrement = stepper.locator('.quantity-decrement');

    await expect(increment).toHaveCSS('font-weight', '800');
    await expect(decrement).toHaveCSS('font-weight', '800');

    const incrementBox = await increment.boundingBox();
    const decrementBox = await decrement.boundingBox();
    expect(incrementBox).not.toBeNull();
    expect(decrementBox).not.toBeNull();
    expect(incrementBox!.width).toBeGreaterThanOrEqual(44);
    expect(incrementBox!.height).toBeGreaterThanOrEqual(44);
    expect(decrementBox!.width).toBeGreaterThanOrEqual(44);
    expect(decrementBox!.height).toBeGreaterThanOrEqual(44);

    const incrementColor = await increment.evaluate((node) => getComputedStyle(node).color);
    const decrementColor = await decrement.evaluate((node) => getComputedStyle(node).color);
    expect(incrementColor).not.toBe(decrementColor);
  }

  await expect(fixture.getByLabel('Add one Fixture')).toHaveText('+');
  await expect(fixture.getByLabel('Remove one Fixture')).toHaveText('−');
  await expect(fixture.getByLabel('Increase Fixture quantity')).toHaveText('+');
  await expect(fixture.getByLabel('Decrease Fixture quantity')).toHaveText('−');
});

test('cashier controls remove press displacement when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await mountCashierStyleFixture(page);
  const increment = fixture.locator('.product-quantity .quantity-increment');
  const box = await increment.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  expect(await increment.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
});

test('dark selected cashier labels use the dedicated readable accent token', async ({ page }) => {
  const fixture = await mountCashierStyleFixture(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });

  const selected = fixture.locator('.order-type-section button.selected');
  const selectedColor = await selected.evaluate((node) => getComputedStyle(node).color);
  const tokenColor = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--tux-accent-text)';
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

  expect(selectedColor).toBe(tokenColor);
});
