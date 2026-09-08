import { expect, test, type Page, type TestInfo } from '@playwright/test';

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

const productRows = categoryRows.map(([categoryId, slug, name], index) => ({
  id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  slug: `canonical-${slug}`,
  categoryId,
  name: `Canonical ${name}`,
  description: `${name} canonical product`,
  priceMinor: 10_000 + index * 1_000,
  imageUrl: null,
  bestSeller: index === 0,
  active: true,
  soldOut: false,
  isCombo: slug === 'combos',
  sortOrder: 0,
}));

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
  products: productRows,
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
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
  ['/products/tux-burger', 'deep-link-tux-burger'],
] as const;

test('captures required Menu visual-parity evidence including cart-open state', async ({ page }, testInfo) => {
  await installCatalog(page);

  for (const [path, label] of routes) {
    await capture(page, testInfo, path, label);
  }

  await page.goto('/order-now', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to Cart' }).first().click();
  await page.locator('nav button:visible').last().click();
  await expect(page.getByText('Your Cart', { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath(`${testInfo.project.name}-cart-open.png`),
    fullPage: true,
  });
});
