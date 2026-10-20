import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_WIDE_TABLET_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondShopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
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

async function mockCatalog(
  page: Page,
  options: { allowSecondShop?: boolean; productCount?: number; emptyCatalog?: boolean } = {},
) {
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
      body: JSON.stringify({
        ...ownerSession,
        principal: {
          ...ownerSession.principal,
          shopIds: options.allowSecondShop ? [shopId, secondShopId] : [shopId],
          shopSummaries: options.allowSecondShop
            ? [
                { id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false },
                { id: secondShopId, name: 'TUX Zamalek', active: true, temporaryClosed: false },
              ]
            : [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
        },
      }),
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
          products: options.emptyCatalog
            ? []
            : [
                liveProduct,
                ...Array.from(
                  { length: Math.max(0, (options.productCount ?? 1) - 1) },
                  (_, index): FixtureProduct => ({
                    ...liveProduct,
                    id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`,
                    name: `Catalog item ${String(index + 2).padStart(2, '0')} · long product name`,
                    slug: `catalog-item-${index + 2}`,
                    priceMinor: 1200 + index * 50,
                    soldOut: index % 7 === 0,
                    sortOrder: 20 + index * 10,
                  }),
                ),
              ],
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

for (const viewport of ADMIN_WIDE_TABLET_VIEWPORTS) {
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
      await expect(page).toHaveURL(new RegExp(`/catalog/products/${productId}$`));
      await expect(list).toBeHidden();
      await expect(inspector).toBeVisible();
      await expect(page.getByRole('button', { name: 'Products' })).toBeVisible();
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByText('Recipe / Inventory')).toBeVisible();
      await expect(page.getByText('Shop Overrides')).toBeVisible();
      await page.reload();
      await expect(inspector).toBeVisible();
      await page.getByRole('button', { name: 'Products' }).click();
      await expect(page).toHaveURL(/\/catalog\/products$/);
    } else {
      await expect(inspector).toBeHidden();
      await page.getByRole('button', { name: /Classic Smash/ }).click();
      await expect(inspector).toBeVisible();
      await expect(page.getByRole('button', { name: 'Products' })).toBeVisible();
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByText('Recipe / Inventory')).toBeVisible();
      await expect(page.getByText('Shop Overrides')).toBeVisible();
    }
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

  await page.getByRole('button', { name: /Classic Smash/ }).click();
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

test('switching shops requires explicit discard for a dirty product editor', async ({ page }) => {
  const fixture = await mockCatalog(page, { allowSecondShop: true });
  await page.goto('/catalog/products');

  const shopSwitcher = page.locator('.shop-switcher select');
  await expect(shopSwitcher).toHaveValue(shopId);
  await page.getByRole('button', { name: /Classic Smash/ }).click();
  const productName = page.locator('input[name="name"]');
  await expect(productName).toHaveValue('Classic Smash');
  await productName.fill('Unsaved operator edit');

  await shopSwitcher.selectOption(secondShopId);
  const confirmation = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(confirmation).toBeVisible();
  await expect(shopSwitcher).toHaveValue(shopId);
  await page.screenshot({
    path: 'test-results/admin-stage1-catalog-shop-switch-confirmation.png',
  });
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(confirmation).toBeHidden();
  await expect(productName).toHaveValue('Unsaved operator edit');
  expect(fixture.commands).toHaveLength(0);

  await shopSwitcher.selectOption(secondShopId);
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(shopSwitcher).toHaveValue(secondShopId);
  expect(fixture.commands).toHaveLength(0);
});

if (process.env['P02_CAPTURE'] === '1') {
  const widths = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
    { width: 375, height: 844 },
    { width: 320, height: 720 },
  ] as const;
  for (const viewport of widths) {
    test(`P02 screenshots: catalog browse, editor and modifiers ${viewport.width}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await mockCatalog(page, { productCount: 49 });
      await page.goto('/catalog/products');
      await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
      await expect(page.locator('[data-catalog-list]')).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-populated-${viewport.width}-light.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: /Classic Smash/ }).click();
      await expect(page.locator('[data-catalog-inspector]')).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-editor-${viewport.width}-light.png`,
        fullPage: true,
      });
      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByText('Extras / Modifiers')).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-modifiers-${viewport.width}-light.png`,
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({
        path: `artifacts/p02/catalog-editor-${viewport.width}-dark.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
    test(`P02 screenshots: empty catalog ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockCatalog(page, { emptyCatalog: true });
      await page.goto('/catalog/products');
      await expect(page.getByText('No products match these filters.')).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-empty-${viewport.width}-light.png`,
        fullPage: true,
      });
    });
  }
}
