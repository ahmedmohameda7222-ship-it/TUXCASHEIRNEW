import { expect, test, type Page } from '@playwright/test';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const CATALOG_URL = 'https://catalog.test/functions/v1/catalog-public';
const ORDER_INTAKE_URL = 'https://orders.test/functions/v1/order-intake';
const REQUEST_ID = '90000000-0000-4000-8000-000000000001';

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

async function openCartWithFirstProduct(page: Page): Promise<void> {
  await installCatalogFixture(page);
  await page.goto('/order-now', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add to Cart' }).first().click();
  await page.locator('nav button:visible').last().click();
  await expect(page.getByText('Your Cart', { exact: true })).toBeVisible();
}

function assertNoBrowserAuthority(payload: Record<string, unknown>): void {
  const forbidden = new Set([
    'price',
    'priceMinor',
    'subtotalMinor',
    'totalMinor',
    'deliveryFeeMinor',
    'businessDayId',
    'operator',
    'cashAmount',
    'cashReceivedMinor',
    'changeMinor',
    'zoneId',
    'payments',
  ]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      expect(forbidden.has(key), `browser payload contained forbidden authority field ${key}`).toBe(
        false,
      );
      visit(nested);
    }
  };
  visit(payload);
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

test('delivery checkout persists a PENDING canonical order before any WhatsApp continuation', async ({
  page,
}) => {
  await openCartWithFirstProduct(page);
  let submitted: Record<string, unknown> | null = null;
  let popupCount = 0;
  page.on('popup', () => {
    popupCount += 1;
  });
  await page.route(`${ORDER_INTAKE_URL}**`, async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, status: 'PENDING' }),
    });
  });

  await page.getByPlaceholder('e.g. Ahmed').fill('Ahmed Mohamed');
  await page.getByRole('button', { name: 'Delivery' }).click();
  await page.getByPlaceholder('e.g. 01001234567').fill('+20 100 123 4567');
  await page.getByPlaceholder('Enter your full address').fill('Nasr City, Cairo');
  await page.getByRole('button', { name: 'Mixed Payment' }).click();
  await page.getByRole('button', { name: 'Place Order' }).click();

  await expect(page.getByText(/Order received/i)).toBeVisible();
  await expect(page.getByText(/pending confirmation/i)).toBeVisible();
  expect(popupCount).toBe(0);
  expect(submitted).not.toBeNull();
  const payload = submitted!;
  expect(payload.schemaVersion).toBe(1);
  expect(payload.shopId).toBe(SHOP_ID);
  expect(payload.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(payload.customer).toEqual({
    name: 'Ahmed Mohamed',
    phone: '+20 100 123 4567',
    address: 'Nasr City, Cairo',
  });
  expect(payload.fulfillmentPreference).toBe('DELIVERY');
  expect(payload.paymentPreference).toBe('MIXED');
  expect(payload.items).toEqual([
    {
      productId: productRows[0][0],
      quantity: 1,
      addonProductIds: [],
      modifierSelections: [],
      comboBeverageProductId: null,
      note: null,
    },
  ]);
  expect(payload.orderNote).toBeNull();
  assertNoBrowserAuthority(payload);
});

test('network retry reuses the same idempotency key and does not clear the cart before success', async ({
  page,
}) => {
  await openCartWithFirstProduct(page);
  const submittedKeys: string[] = [];
  let attempt = 0;
  await page.route(`${ORDER_INTAKE_URL}**`, async (route) => {
    attempt += 1;
    const body = route.request().postDataJSON() as { idempotencyKey: string };
    submittedKeys.push(body.idempotencyKey);
    if (attempt === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, status: 'PENDING' }),
    });
  });

  await page.getByPlaceholder('e.g. Ahmed').fill('Ahmed Mohamed');
  await page.getByRole('button', { name: 'Pick up' }).click();
  await page.getByRole('button', { name: 'Cash' }).click();
  await page.getByRole('button', { name: 'Place Order' }).click();

  await expect(page.getByText(/could not place your order/i)).toBeVisible();
  await expect(page.locator('h4').filter({ hasText: 'Canonical Tux Burger' })).toBeVisible();
  await page.getByRole('button', { name: 'Place Order' }).click();
  await expect(page.getByText(/Order received/i)).toBeVisible();

  expect(submittedKeys).toHaveLength(2);
  expect(submittedKeys[1]).toBe(submittedKeys[0]);
});

test('pickup Mixed Payment is preference only and omits delivery identity and settlement amounts', async ({
  page,
}) => {
  await openCartWithFirstProduct(page);
  let submitted: Record<string, unknown> | null = null;
  await page.route(`${ORDER_INTAKE_URL}**`, async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, requestId: REQUEST_ID, status: 'PENDING' }),
    });
  });

  await page.getByPlaceholder('e.g. Ahmed').fill('Ahmed Mohamed');
  await page.getByRole('button', { name: 'Pick up' }).click();
  await page.getByRole('button', { name: 'Mixed Payment' }).click();

  await expect(page.getByText('Cash Amount', { exact: true })).toHaveCount(0);
  await expect(page.getByText('InstaPay Amount', { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder('e.g. 01001234567')).toHaveCount(0);
  await page.getByRole('button', { name: 'Place Order' }).click();
  await expect(page.getByText(/Order received/i)).toBeVisible();

  expect(submitted).not.toBeNull();
  const payload = submitted!;
  expect(payload.customer).toEqual({ name: 'Ahmed Mohamed', phone: null, address: null });
  expect(payload.fulfillmentPreference).toBe('PICKUP');
  expect(payload.paymentPreference).toBe('MIXED');
  assertNoBrowserAuthority(payload);
});
