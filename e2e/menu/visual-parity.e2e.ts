import { expect, test, type Page, type TestInfo } from '@playwright/test';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_URL = 'https://catalog.test/functions/v1/catalog-public';

const categoryRows = [
  ['20000000-0000-4000-8000-000000000001', 'burgers', 'Burgers'],
  ['20000000-0000-4000-8000-000000000002', 'hawawshi', 'Hawawshi'],
  ['20000000-0000-4000-8000-000000000003', 'fries', 'Fries'],
  ['20000000-0000-4000-8000-000000000004', 'combos', 'Combos'],
  ['20000000-0000-4000-8000-000000000005', 'drinks', 'Drinks'],
] as const;

const productRows = [
  {
    id: '30000000-0000-4000-8000-000000000001',
    slug: 'canonical-tux-burger',
    categoryId: categoryRows[0][0],
    name: 'Canonical Tux Burger',
    description: 'TUX canonical product',
    priceMinor: 10_000,
    imageUrl: null,
    family: 'TUX',
    bestSeller: true,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 0,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    slug: 'canonical-tuxify',
    categoryId: categoryRows[0][0],
    name: 'Canonical Tuxify',
    description: 'TUXIFY canonical product',
    priceMinor: 11_000,
    imageUrl: null,
    family: 'TUXIFY',
    bestSeller: false,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 1,
  },
  ...categoryRows.slice(1).map(([categoryId, slug, name], index) => ({
    id: `30000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
    slug: `canonical-${slug}`,
    categoryId,
    name: `Canonical ${name}`,
    description: `${name} canonical product`,
    priceMinor: 12_000 + index * 1_000,
    imageUrl: null,
    family: null,
    bestSeller: false,
    active: true,
    soldOut: false,
    isCombo: slug === 'combos',
    sortOrder: 0,
  })),
];

const catalogFixture = {
  schemaVersion: 2,
  shopId: SHOP_ID,
  revision: 'a'.repeat(64),
  categories: categoryRows.map(([id, slug, name], sortOrder) => ({
    id,
    slug,
    name,
    description: `${name} canonical category`,
    active: true,
    sortOrder,
  })),
  products: productRows,
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
  ordering: {
    available: true,
    temporaryClosed: false,
    onlineOrdersPaused: false,
    minimumOrderMinor: 0,
    fulfillmentPreferences: ['PICKUP', 'DELIVERY'],
    paymentPreferences: ['CASH', 'INSTAPAY', 'MIXED'],
  },
};

async function installCatalog(page: Page): Promise<void> {
  await page.route(`${CATALOG_URL}**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogFixture),
    });
  });
}

async function capture(page: Page, testInfo: TestInfo, path: string, label: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: 'networkidle' });
  expect(response?.ok()).toBe(true);
  await expect(page.locator('body')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-${label}.png`),
    fullPage: true,
  });
}

const routes = [
  ['/', 'home'],
  ['/order-now', 'order-now'],
  ['/tux-burger', 'tux-burger'],
  ['/tuxify', 'tuxify'],
  ['/hawawshi', 'hawawshi'],
  ['/fries', 'fries'],
  ['/combos', 'combos'],
  ['/drinks', 'drinks'],
  ['/products/burgers', 'deep-link-burgers'],
] as const;

test('captures required Menu visual-parity evidence including cart-open state', async ({
  page,
}, testInfo) => {
  await installCatalog(page);

  for (const [path, label] of routes) {
    await capture(page, testInfo, path, label);
  }

  await page.goto('/order-now', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to Cart' }).first().click();
  await page.getByRole('button', { name: 'Cart', exact: true }).click();
  await expect(page.getByText('Your Cart', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-cart-open.png`),
    fullPage: true,
  });
});
