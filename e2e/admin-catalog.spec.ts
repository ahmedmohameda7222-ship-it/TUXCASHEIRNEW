import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const categoryId = '22222222-2222-4222-8222-222222222222';
const productId = '11111111-1111-4111-8111-111111111111';

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['catalog.view', 'catalog.edit', 'catalog.pricing', 'catalog.publish'],
    shopIds: [shopId],
  },
  csrfToken: 'a'.repeat(64),
};

type FixtureProduct = {
  id: string;
  shopId: string;
  categoryId: string;
  slug: string | null;
  name: string;
  description: string | null;
  priceMinor: number;
  imageKey: string | null;
  family: string | null;
  bestSeller: boolean;
  active: boolean;
  soldOut: boolean;
  isCombo: boolean;
  sortOrder: number;
};

type CatalogCommandBody = {
  type?: string;
  soldOut?: boolean;
  changes?: Array<{ bundleJson?: Record<string, unknown> }>;
};

function canonicalBundle(product: FixtureProduct, version: number) {
  return {
    snapshot: {
      shopId,
      version,
      updatedAt: '2026-09-11T00:00:00.000Z',
      categories: [
        {
          id: categoryId,
          shopId,
          slug: 'burgers',
          name: 'Burgers',
          description: null,
          sortOrder: 10,
          active: true,
        },
      ],
      products: [product],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [],
      deliveryZones: [],
    },
    inventoryItems: [],
  };
}

async function mockCatalog(page: Page) {
  let publishVersion = 48;
  let draftRevision = 1;
  let liveProduct: FixtureProduct = {
    id: productId,
    shopId,
    categoryId,
    slug: 'classic-smash',
    name: 'Classic Smash',
    description: 'Single smashed burger',
    priceMinor: 1550,
    imageKey: 'products/classic-smash.png',
    family: 'burger',
    bestSeller: true,
    active: true,
    soldOut: false,
    isCombo: false,
    sortOrder: 10,
  };
  let draftBundle = canonicalBundle(liveProduct, publishVersion);
  const commands: CatalogCommandBody[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/catalog**', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          currentPublishVersion: publishVersion,
          categories: [
            {
              id: categoryId,
              shopId,
              slug: 'burgers',
              name: 'Burgers',
              description: null,
              sortOrder: 10,
              active: true,
            },
          ],
          products: [liveProduct],
          drafts: [],
        }),
      });
      return;
    }

    expect(request.headers()['x-tux-admin-csrf']).toBe(ownerSession.csrfToken);
    const body = request.postDataJSON() as CatalogCommandBody;
    commands.push(body);

    if (body.type === 'draft.create') {
      draftRevision = 1;
      draftBundle = canonicalBundle(liveProduct, publishVersion);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId: '55555555-5555-4555-8555-555555555555',
          draftRevision,
          basePublishVersion: publishVersion,
          bundleJson: draftBundle,
        }),
      });
      return;
    }

    if (body.type === 'draft.save') {
      draftRevision += 1;
      const nextBundle = body.changes?.[0]?.bundleJson;
      if (nextBundle) draftBundle = nextBundle as ReturnType<typeof canonicalBundle>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          draftId: '55555555-5555-4555-8555-555555555555',
          draftRevision,
          basePublishVersion: publishVersion,
        }),
      });
      return;
    }

    if (body.type === 'availability.set') {
      publishVersion += 1;
      liveProduct = { ...liveProduct, soldOut: body.soldOut === true };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          productId,
          soldOut: liveProduct.soldOut,
          publishVersion,
          operationsConfigurationVersion: publishVersion,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected_catalog_command' }),
    });
  });

  return { commands };
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 900, height: 1024 },
  { name: 'desktop', width: 1440, height: 1000 },
] as const) {
  test(`catalog uses the approved ${viewport.name} management layout`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockCatalog(page);
    await page.goto('/catalog/products');

    await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
    const list = page.locator('[data-catalog-list]');
    const inspector = page.locator('[data-catalog-inspector]');
    await expect(list).toBeVisible();

    if (viewport.name === 'phone') {
      await expect(inspector).toBeHidden();
      await page.getByRole('button', { name: /Classic Smash/ }).click();
      await expect(list).toBeHidden();
      await expect(inspector).toBeVisible();
      await expect(page.getByRole('button', { name: 'Products' })).toBeVisible();
    } else {
      await expect(inspector).toBeVisible();
      await expect(page.getByRole('button', { name: 'Products' })).toBeHidden();
    }

    await page.getByRole('button', { name: 'More' }).click();
    await expect(page.getByText('Recipe / Inventory')).toBeVisible();
    await expect(page.getByText('Shop Overrides')).toBeVisible();
  });
}

test('catalog search filters the live workspace without mutating authority', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/catalog/products');

  await page.getByRole('searchbox', { name: 'Search products' }).fill('no-match');
  await expect(page.getByText('No products match these filters.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toHaveCount(0);
});

test('normal product edit creates a draft while Sold Out uses the immediate command', async ({
  page,
}) => {
  const fixture = await mockCatalog(page);
  await page.goto('/catalog/products');

  const name = page.locator('input[name="name"]');
  await name.fill('Classic Smash Updated');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft in progress')).toBeVisible();
  await expect(page.getByText('Not live')).toBeVisible();
  expect(fixture.commands.map((command) => command.type)).toEqual(['draft.create', 'draft.save']);

  await page.getByRole('button', { name: 'Mark sold out' }).click();
  await expect(page.getByText('Live availability changed.')).toBeVisible();
  expect(fixture.commands.map((command) => command.type)).toEqual([
    'draft.create',
    'draft.save',
    'availability.set',
  ]);
  const availability = fixture.commands.at(-1);
  expect(availability).toMatchObject({ type: 'availability.set', soldOut: true });
});
