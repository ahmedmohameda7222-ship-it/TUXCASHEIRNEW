import { expect, test, type Page } from '@playwright/test';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_URL = 'https://catalog.test/functions/v1/catalog-public';

const categoryRows = [
  ['20000000-0000-4000-8000-000000000001', 'tux-burger', 'Tux Burger'],
  ['20000000-0000-4000-8000-000000000002', 'tuxify', 'Tuxify Burger'],
  ['20000000-0000-4000-8000-000000000003', 'hawawshi', 'Hawawshi'],
  ['20000000-0000-4000-8000-000000000004', 'fries', 'Fries'],
  ['20000000-0000-4000-8000-000000000005', 'combos', 'Combos'],
  ['20000000-0000-4000-8000-000000000006', 'drinks', 'Drinks'],
] as const;

const productRows = [
  [
    '30000000-0000-4000-8000-000000000001',
    categoryRows[0][0],
    'canonical-tux-burger',
    'Canonical Tux Burger',
    19050,
  ],
  [
    '30000000-0000-4000-8000-000000000002',
    categoryRows[1][0],
    'canonical-tuxify',
    'Canonical Tuxify',
    18000,
  ],
  [
    '30000000-0000-4000-8000-000000000003',
    categoryRows[2][0],
    'canonical-hawawshi',
    'Canonical Hawawshi',
    12000,
  ],
  [
    '30000000-0000-4000-8000-000000000004',
    categoryRows[3][0],
    'canonical-fries',
    'Canonical Fries',
    3000,
  ],
  [
    '30000000-0000-4000-8000-000000000005',
    categoryRows[4][0],
    'canonical-combo',
    'Canonical Combo',
    6000,
  ],
  [
    '30000000-0000-4000-8000-000000000006',
    categoryRows[5][0],
    'canonical-drink',
    'Canonical Drink',
    2500,
  ],
] as const;

const catalogFixture = {
  schemaVersion: 1,
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
  products: productRows.map(([id, categoryId, slug, name, priceMinor], sortOrder) => ({
    id,
    slug,
    categoryId,
    name,
    description: `${name} canonical product`,
    priceMinor,
    imageUrl: null,
    bestSeller: sortOrder === 0,
    active: true,
    soldOut: false,
    isCombo: slug.includes('combo'),
    sortOrder: 0,
  })),
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
};

async function installCatalogFixture(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route(`${CATALOG_URL}**`, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(catalogFixture),
    });
  });
  return requests;
}

const routes = [
  { path: '/', text: /TUX/i },
  { path: '/order-now', text: /Order\s*Now/i },
  { path: '/tux-burger', text: /Tux Burger/i },
  { path: '/tuxify', text: /Tuxify Burger/i },
  { path: '/hawawshi', text: /Hawawshi/i },
  { path: '/fries', text: /Fries/i },
  { path: '/combos', text: /Combos/i },
  { path: '/drinks', text: /Drinks/i },
] as const;

for (const route of routes) {
  test(`direct entry renders ${route.path} from canonical public catalog`, async ({ page }) => {
    await installCatalogFixture(page);
    const response = await page.goto(route.path, { waitUntil: 'networkidle' });

    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(route.text);
  });
}

test('uses catalog-public UUID identity and priceMinor without stale fallback', async ({
  page,
}) => {
  const requests = await installCatalogFixture(page);
  await page.goto('/tux-burger', { waitUntil: 'networkidle' });

  await expect(page.getByText('Canonical Tux Burger', { exact: true })).toBeVisible();
  await expect(page.getByText('190.5 EGP', { exact: true })).toBeVisible();
  await expect(page.getByText('Double Tux Burger', { exact: true })).toHaveCount(0);
  expect(requests).toEqual([`${CATALOG_URL}?shopId=${SHOP_ID}`]);
});

test('shows explicit unavailable state instead of checked-in catalog data', async ({ page }) => {
  await page.route(`${CATALOG_URL}**`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        error: { code: 'catalog_unavailable' },
      }),
    });
  });
  await page.goto('/order-now', { waitUntil: 'networkidle' });

  await expect(page.getByText(/Menu temporarily unavailable/i)).toBeVisible();
  await expect(page.getByText('Single Tux Burger', { exact: true })).toHaveCount(0);
});

test('legacy customer-runtime admin route is retired', async ({ page }) => {
  await installCatalogFixture(page);
  await page.goto('/admin', { waitUntil: 'networkidle' });

  await expect(page.getByText('404 Page Not Found', { exact: true })).toBeVisible();
  await expect(page.getByText(/Admin Login/i)).toHaveCount(0);
});

test('home images have real dimensions', async ({ page }) => {
  await installCatalogFixture(page);
  await page.goto('/', { waitUntil: 'networkidle' });
  const images = await page.locator('img').evaluateAll((nodes) =>
    nodes.map((node) => ({
      src: (node as HTMLImageElement).currentSrc,
      width: (node as HTMLImageElement).naturalWidth,
      height: (node as HTMLImageElement).naturalHeight,
    })),
  );

  expect(images.length).toBeGreaterThan(0);
  expect(
    images.filter((image) => image.src).every((image) => image.width > 0 && image.height > 0),
  ).toBe(true);
});

test('canonical category slug survives product deep-route entry', async ({ page }) => {
  await installCatalogFixture(page);
  await page.goto('/products/tux-burger', { waitUntil: 'networkidle' });

  await expect(page).toHaveURL(/\/products\/tux-burger$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tux Burger' })).toBeVisible();
  await expect(page.getByText('Canonical Tux Burger', { exact: true })).toBeVisible();
});
