import { expect, test, type Page } from '@playwright/test';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_URL = 'https://catalog.test/functions/v1/catalog-public';
const ORDER_INTAKE_URL = 'https://orders.test/functions/v1/order-intake';

interface OrderingFixture {
  available: boolean;
  temporaryClosed: boolean;
  onlineOrdersPaused: boolean;
  minimumOrderMinor: number;
  fulfillmentPreferences: Array<'PICKUP' | 'DELIVERY'>;
  paymentPreferences: Array<'CASH' | 'INSTAPAY' | 'MIXED'>;
}

const catalogFixture = (ordering: OrderingFixture) => ({
  schemaVersion: 2,
  shopId: SHOP_ID,
  revision: 'b'.repeat(64),
  categories: [
    {
      id: '20000000-0000-4000-8000-000000000001',
      slug: 'burgers',
      name: 'Burgers',
      description: 'Burgers canonical category',
      active: true,
      sortOrder: 0,
    },
  ],
  products: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      slug: 'canonical-tux-burger',
      categoryId: '20000000-0000-4000-8000-000000000001',
      name: 'Canonical Tux Burger',
      description: 'TUX canonical product',
      priceMinor: 19_050,
      imageUrl: null,
      family: 'TUX',
      bestSeller: true,
      active: true,
      soldOut: false,
      isCombo: false,
      sortOrder: 0,
    },
  ],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  shop: {
    displayName: 'TUX Test Shop',
    address: 'Road 9, Maadi',
    phone: '+201000000000',
    latitude: 29.9602,
    longitude: 31.2569,
  },
  ordering,
});

async function openCart(page: Page, ordering: OrderingFixture): Promise<void> {
  await page.route(`${CATALOG_URL}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogFixture(ordering)),
    });
  });
  await page.goto('/order-now', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to Cart' }).first().click();
  await page.getByRole('button', { name: 'Cart', exact: true }).click();
  await expect(page.getByText('Your Cart', { exact: true })).toBeVisible();
}

const openOrdering: OrderingFixture = {
  available: true,
  temporaryClosed: false,
  onlineOrdersPaused: false,
  minimumOrderMinor: 0,
  fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
  paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
};

test('renders only checkout choices exposed by the published public policy', async ({ page }) => {
  await openCart(page, {
    ...openOrdering,
    fulfillmentPreferences: ['PICKUP'],
    paymentPreferences: ['CASH'],
  });

  await expect(page.getByRole('button', { name: 'Pick up' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delivery' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cash' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'InstaPay' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mixed Payment' })).toHaveCount(0);
});

test('blocks checkout UX when published online ordering is unavailable', async ({ page }) => {
  let orderIntakeRequests = 0;
  await page.route(`${ORDER_INTAKE_URL}**`, async (route) => {
    orderIntakeRequests += 1;
    await route.abort();
  });
  await openCart(page, {
    ...openOrdering,
    available: false,
    onlineOrdersPaused: true,
  });

  await expect(page.getByRole('alert')).toContainText(
    'Online ordering is temporarily unavailable.',
  );
  await expect(page.getByRole('button', { name: 'Place Order' })).toBeDisabled();
  expect(orderIntakeRequests).toBe(0);
});

test('blocks checkout UX below the published minimum order in minor units', async ({ page }) => {
  let orderIntakeRequests = 0;
  await page.route(`${ORDER_INTAKE_URL}**`, async (route) => {
    orderIntakeRequests += 1;
    await route.abort();
  });
  await openCart(page, {
    ...openOrdering,
    minimumOrderMinor: 20_000,
  });

  await expect(page.getByRole('alert')).toContainText('Minimum order is 200 EGP.');
  await expect(page.getByRole('button', { name: 'Place Order' })).toBeDisabled();
  expect(orderIntakeRequests).toBe(0);
});
