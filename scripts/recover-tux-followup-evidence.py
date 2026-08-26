from pathlib import Path

path = Path('e2e/operations.e2e.ts')
source = path.read_text()
marker = "test('follow-up desktop approval evidence is captured from the committed tree'"
if marker in source:
    raise SystemExit('follow-up evidence already exists')

block = r'''

test('follow-up desktop approval evidence is captured from the committed tree', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');

  const shot = async (name: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  };

  await enterActiveOrdersForCategoryTests(page);
  await setAppearance(page, 'Light');
  await shot('followup-01-orders-default-1440.png');

  await page.keyboard.press('Control+K');
  const search = page.getByPlaceholder('Search products');
  await search.fill('smashed');
  await shot('followup-02-orders-search-1440.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Edit categories' }).click();
  await expect(page.getByLabel('Edit categories')).toBeVisible();
  await shot('followup-03-orders-category-edit-1440.png');
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  let cart = currentOrderCart(page, testInfo);
  let line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(line.getByRole('button', { name: 'Extra', exact: true })).toBeVisible();
  await expect(line.locator('[data-icon="plus-circle"]')).toHaveCount(1);
  await shot('followup-04-current-order-plain-extra-1440.png');

  await line.getByRole('button', { name: 'Extra', exact: true }).click();
  let extras = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await extras.getByRole('button', { name: 'Add one Extra Cheese' }).click();
  await extras.getByRole('button', { name: 'Save item' }).click();
  line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  await expect(line).toContainText('1× Extra Cheese');
  await expect(line.locator('[data-icon="edit-pencil"]')).toHaveCount(1);
  await shot('followup-05-current-order-custom-extra-1440.png');

  const card = page.locator('.product-card').filter({ hasText: 'Single Smashed Patty' }).first();
  await card.getByRole('button', { name: 'Quick Info for Single Smashed Patty' }).click();
  const quickInfo = page.getByRole('dialog', { name: 'Single Smashed Patty' });
  await expect(quickInfo.locator('.quick-info-body p')).toContainText('1 smashed patty');
  await shot('followup-06-quick-info-description-1440.png');
  await quickInfo.getByRole('button', { name: 'Close' }).click();

  cart = currentOrderCart(page, testInfo);
  await cart.getByRole('button', { name: 'Delivery', exact: true }).click();
  await cart.getByLabel('Phone').fill('01000000000');
  await cart.getByLabel('Customer name').fill('Evidence Customer');
  await cart.getByLabel('Zone').selectOption({ label: /Downtown Demo/ });
  await cart.getByLabel('Full address').fill('Evidence address');
  const deliveryTotal = cart.getByLabel('Delivery', { exact: true });
  await expect(deliveryTotal).toBeVisible();
  await deliveryTotal.fill('45');
  await deliveryTotal.blur();
  await shot('followup-07-delivery-fee-totals-1440.png');

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await expect(page.getByText('No expenses this business day', { exact: true })).toBeVisible();
  await shot('followup-08-expenses-empty-1440.png');

  await page.getByLabel('Description').fill('Packaging bags');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Amount').blur();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel(/Note/).fill('Evidence note');
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await expect(page.getByText('Packaging bags')).toBeVisible();
  await shot('followup-09-expenses-populated-1440.png');

  await setAppearance(page, 'Dark');
  await shot('followup-10-expenses-dark-1440.png');
  await setAppearance(page, 'Light');

  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Stock' })).toBeVisible();
  await expect(page.locator('.bulk-stock-card')).toHaveCount(2);
  await shot('followup-11-bulk-stock-populated-1440.png');

  await setAppearance(page, 'Dark');
  await shot('followup-12-bulk-stock-dark-1440.png');
  await setAppearance(page, 'Light');

  const stockCard = page.locator('.bulk-stock-card').filter({ hasText: 'Fries Bulk Bag' });
  await stockCard.getByRole('button', { name: 'Add Stock' }).click();
  const addStock = page.getByRole('dialog', { name: /Add Stock — Fries Bulk Bag/ });
  await expect(addStock.getByLabel('Whole units received')).toBeVisible();
  await shot('followup-13-add-stock-dialog-1440.png');
  await addStock.getByRole('button', { name: 'Cancel' }).click();

  await page.evaluate(async (databaseName) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('inventoryItems', 'readwrite');
      const store = transaction.objectStore('inventoryItems');
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result as Array<Record<string, unknown>>) {
          if (item['trackingMode'] === 'BULK_MANUAL') store.put({ ...item, active: false });
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, DATABASE);
  await page.reload();
  await waitForActiveShell(page);
  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.locator('.bulk-stock-card')).toHaveCount(0);
  await expect(page.locator('.bulk-stock-empty')).toBeVisible();
  await shot('followup-14-bulk-stock-empty-1440.png');
});

test('follow-up mobile approval evidence is captured from the committed tree', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-browser-fallback');

  const shot = async (name: string): Promise<void> => {
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(name),
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
  };

  await enterActiveOrdersForCategoryTests(page);
  await setAppearance(page, 'Light');
  await shot('followup-15-orders-default-375.png');

  await page.keyboard.press('Control+K');
  const search = page.getByPlaceholder('Search products');
  await search.fill('smashed');
  await shot('followup-16-orders-search-375.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const mobileCart = currentOrderCart(page, testInfo);
  await mobileCart.getByRole('button', { name: 'Cash', exact: true }).click();
  await expect(mobileCart.getByLabel('Cash received')).toBeVisible();
  const lastPaymentControl = mobileCart.locator('.payment-section').last();
  const footer = mobileCart.locator('.cart-totals');
  const [paymentBox, footerBox] = await Promise.all([
    lastPaymentControl.boundingBox(),
    footer.boundingBox(),
  ]);
  expect(paymentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (paymentBox!.y + paymentBox!.height)).toBeGreaterThanOrEqual(16);
  await shot('followup-17-review-pay-bottom-375.png');
  await page.getByRole('button', { name: 'Close order' }).click();

  await page.getByRole('button', { name: 'Expenses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await shot('followup-18-expenses-form-375.png');
  await page.getByLabel('Description').fill('Packaging bags');
  await page.getByLabel('Amount').fill('25');
  await page.getByLabel('Amount').blur();
  await page.getByRole('button', { name: 'Add Expense', exact: true }).click();
  await expect(page.getByText('Packaging bags')).toBeVisible();
  await shot('followup-19-expenses-populated-375.png');

  await page.getByRole('button', { name: 'Bulk Stock', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bulk Stock' })).toBeVisible();
  await shot('followup-20-bulk-stock-populated-375.png');
  const stockCard = page.locator('.bulk-stock-card').filter({ hasText: 'Fries Bulk Bag' });
  await stockCard.getByRole('button', { name: 'Add Stock' }).click();
  await expect(page.getByRole('dialog', { name: /Add Stock — Fries Bulk Bag/ })).toBeVisible();
  await shot('followup-21-add-stock-dialog-375.png');
});
'''

path.write_text(source.rstrip() + block + '\n')
print('follow-up rendered evidence coverage restored')
