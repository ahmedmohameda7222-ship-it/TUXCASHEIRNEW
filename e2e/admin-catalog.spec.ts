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
    if (
      request.method() === 'GET' &&
      new URL(request.url()).searchParams.get('view') === 'publishing'
    ) {
      const requestedShop = new URL(request.url()).searchParams.get('shopId') ?? shopId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId: requestedShop,
          currentPublishVersion: publishVersion,
          versions: [],
          draftPreviews: [],
          schedules: [],
        }),
      });
      return;
    }
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

test('C2 definitions tabs show the selected collection and protect an open editor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: 'Manage categories & extras' }).click();

  const categories = page.getByRole('tab', { name: /Categories/ });
  const modifiers = page.getByRole('tab', { name: /Modifiers \/ Extras/ });
  await expect(categories).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Modifiers / extras' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/catalog-c2-categories-mobile-390.png' });

  await modifiers.click();
  await expect(modifiers).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Modifiers / extras' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/catalog-c2-modifiers-mobile-390.png' });
  await page.getByRole('button', { name: 'Add modifier' }).click();
  await expect(page.getByRole('heading', { name: 'Modifier details' })).toBeVisible();
  await expect(categories).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await categories.click();
  await expect(categories).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
});

test('C2 definitions tabs match accessible desktop collection switching', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: 'Manage categories & extras' }).click();
  await expect(page.getByRole('button', { name: 'Add category' })).toBeVisible();
  await page.screenshot({ path: 'test-results/catalog-c2-categories-desktop-1440.png' });

  await page.getByRole('tab', { name: /Modifiers \/ Extras/ }).click();
  await expect(page.getByRole('button', { name: 'Add modifier' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/catalog-c2-modifiers-desktop-1440.png' });
});

test('C2 Manage workspace shows one draft notice and no product creation toolbar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: 'Manage categories & extras' }).click();

  await expect(page.getByRole('button', { name: 'Back to products' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New product' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bulk Edit' })).toHaveCount(0);
  await expect(page.locator('.admin-catalog-draft-banner')).toHaveCount(1);
  await expect(page.locator('.admin-catalog-definition-row')).toHaveCount(1);
});

test('C2 category creation persists to its shop draft without publication', async ({ page }) => {
  const fixture = await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: 'Manage categories & extras' }).click();
  await page.getByRole('button', { name: 'Add category' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sides');
  await page.getByRole('button', { name: 'Save definition to draft' }).click();
  const createdCategoryName = page.getByRole('tabpanel').getByText('Sides', { exact: true });
  await expect(createdCategoryName).toBeVisible();

  expect(fixture.commands.map((command) => command.type)).toEqual(['draft.create', 'draft.save']);
  const saved = fixture.commands.at(-1)?.changes?.[0]?.bundleJson;
  expect(saved?.snapshot).toMatchObject({ shopId });
  const definitions = (saved?.snapshot as { categories?: Array<{ shopId: string; name: string }> })
    ?.categories;
  expect(definitions).toEqual(
    expect.arrayContaining([expect.objectContaining({ shopId, name: 'Sides' })]),
  );
});

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
  await expect(page.getByText('Not live', { exact: true })).toBeVisible();
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
  await expect(shopSwitcher).toHaveValue(shopId);
  await expect(productName).toHaveValue('Unsaved operator edit');
  expect(fixture.commands).toHaveLength(0);

  await shopSwitcher.selectOption(secondShopId);
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard and switch' }).click();
  await expect(shopSwitcher).toHaveValue(secondShopId);
  expect(fixture.commands).toHaveLength(0);
});

if (process.env['P02_CAPTURE'] === '1') {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 844 },
    { width: 320, height: 720 },
  ] as const) {
    test(`P02 screenshot: category and modifier management ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockCatalog(page);
      await page.goto('/catalog/products');
      await page.getByRole('button', { name: 'Manage categories & extras' }).click();
      await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-definitions-${viewport.width}-light.png`,
        fullPage: true,
      });
      await page.getByText('Actions for Burgers').click();
      await expect(page.getByRole('button', { name: 'Edit Burgers' })).toBeVisible();
      await page.screenshot({
        path: `artifacts/p02/catalog-definition-actions-${viewport.width}-light.png`,
        fullPage: true,
      });
    });
  }

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

test('unsaved product edits are guarded at both Review & Publish entry points', async ({
  page,
}) => {
  const fixture = await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: /Classic Smash/ }).click();
  const name = page.locator('input[name="name"]');
  await name.fill('Unsaved review navigation value');
  await page.getByRole('button', { name: /Review & Publish \(/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Discard unsaved product edits?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay and keep editing' }).click();
  await expect(name).toHaveValue('Unsaved review navigation value');
  expect(fixture.commands).toEqual([]);

  await page.getByRole('button', { name: /Review & Publish \(/ }).click();
  dialog = page.getByRole('dialog', { name: 'Discard unsaved product edits?' });
  await dialog.getByRole('button', { name: 'Discard changes and navigate' }).click();
  await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
  expect(fixture.commands).toEqual([]);
});

test('saved product draft permits Review & Publish without false warning', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: /Classic Smash/ }).click();
  await page.locator('input[name="name"]').fill('Saved review navigation');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved — not published')).toBeVisible();
  await page.getByRole('button', { name: 'Review & Publish', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review & publish' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved product edits?' })).toHaveCount(0);
});

test('version history link and browser Back preserve dirty edits until explicitly discarded', async ({
  page,
}) => {
  await mockCatalog(page);
  await page.goto('/catalog/products');
  await page.getByRole('button', { name: /Classic Smash/ }).click();
  const name = page.locator('input[name="name"]');
  await name.fill('Keep through browser navigation');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Open version history' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved product edits?' });
  await dialog.getByRole('button', { name: 'Stay and keep editing' }).click();
  await expect(name).toHaveValue('Keep through browser navigation');
  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Stay and keep editing' }).click();
  await expect(name).toHaveValue('Keep through browser navigation');
});

test('C1 products desktop shows approved category shortcuts and factual data columns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockCatalog(page, { productCount: 12 });
  await page.goto('/catalog/products');

  const categories = page.getByRole('navigation', { name: 'Product categories' });
  await expect(categories.getByRole('button', { name: 'All products 12' })).toBeVisible();
  await expect(categories.getByRole('button', { name: 'Burgers 12' })).toBeVisible();
  const columns = page.locator('[data-catalog-product-columns]');
  await expect(columns).toBeVisible();
  await expect(columns).toContainText('Product');
  await expect(columns).toContainText('Category');
  await expect(columns).toContainText('Price');
  await expect(columns).toContainText('Availability');

  await categories.getByRole('button', { name: 'Burgers 12' }).click();
  await page.getByRole('searchbox', { name: 'Search products' }).fill('no-match');
  await expect(page.getByText('No products match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toBeVisible();
  await expect(categories.getByRole('button', { name: 'All products 12' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: 'test-results/catalog-c1-products-desktop-1440.png' });
});

test('C1 mobile category browse preserves real product routing without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalog(page, { productCount: 12 });
  await page.goto('/catalog/products');

  const categories = page.getByRole('navigation', { name: 'Product categories' });
  await expect(categories.getByRole('button', { name: 'Burgers 12' })).toBeVisible();
  await expect(page.locator('[data-catalog-product-columns]')).toBeHidden();
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: 'Status' })).toBeHidden();
  await filters.click();
  await expect(page.getByRole('combobox', { name: 'Status' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('sold-out');
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await filters.click();
  await expect(filters).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/catalog-c1-products-mobile-390.png' });
  await page.getByRole('button', { name: /Classic Smash/ }).click();
  await expect(page.locator('[data-catalog-inspector]')).toBeVisible();
  await expect(page).toHaveURL(/\/catalog\/products\/11111111-1111-4111-8111-111111111111$/);
  await page.getByRole('button', { name: 'Products', exact: true }).click();
  await expect(page.locator('[data-catalog-list]')).toBeVisible();
});

test('C1 mobile landing exposes the first real product without scrolling past secondary tools', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalog(page, { productCount: 12 });
  await page.goto('/catalog/products');
  await expect(page.getByText('0 pending drafts')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Manage categories & extras' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New product' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toBeInViewport({
    ratio: 0.25,
  });
  await page.getByText('More catalog tools', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bulk Edit' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Review & Publish \(/ })).toBeVisible();
  await expect(page.getByLabel('Mobile new product category')).toBeVisible();
});

test('C1 product browse uses authorized image preview for an existing imageKey', async ({
  page,
}) => {
  await mockCatalog(page);
  const requestedImages: string[] = [];
  await page.route('**/api/admin/catalog-image?*', async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('shopId')).toBe(shopId);
    requestedImages.push(url.searchParams.get('imageKey') ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ publicUrl: 'https://images.example.test/catalog/classic-smash.png' }),
    });
  });
  await page.route('https://images.example.test/catalog/classic-smash.png', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"></svg>',
    });
  });
  await page.goto('/catalog/products');

  const productRow = page.getByRole('button', { name: /Classic Smash/ });
  const thumbnail = productRow.locator('img');
  await expect(thumbnail).toHaveAttribute(
    'src',
    'https://images.example.test/catalog/classic-smash.png',
  );
  await expect(thumbnail).toHaveAttribute('alt', '');
  expect(requestedImages).toContain('products/classic-smash.png');
});

test('C1 phone primary management actions span the available page width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCatalog(page);
  await page.goto('/catalog/products');

  const manage = page.getByRole('button', { name: 'Manage categories & extras' });
  const create = page.getByRole('button', { name: 'New product' });
  await expect(manage).toBeVisible();
  await expect(create).toBeVisible();
  const manageBox = await manage.boundingBox();
  const createBox = await create.boundingBox();
  if (!manageBox || !createBox) throw new Error('Primary Catalog actions must be laid out');

  expect(manageBox.width).toBeGreaterThanOrEqual(330);
  expect(createBox.width).toBeGreaterThanOrEqual(330);
  expect(Math.abs(manageBox.width - createBox.width)).toBeLessThan(3);
});

test('C1 approved primary Catalog action is green with no redundant eyebrow at desktop and mobile', async ({
  page,
}) => {
  await mockCatalog(page, { productCount: 12 });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/catalog/products');
    const action = page.getByRole('button', { name: 'New product' });
    await expect(action).toBeVisible();
    await expect(page.getByText('Catalog control', { exact: true })).toHaveCount(0);
    const rgb = await action.evaluate((element) => {
      const style = getComputedStyle(element);
      const color = style.backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number);
      return color ?? [];
    });
    expect(rgb).toHaveLength(3);
    expect(rgb[1]!).toBeGreaterThan(rgb[0]!);
    expect(rgb[1]!).toBeGreaterThan(rgb[2]!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
] as const) {
  test(`C1 approved browse preserves search, real selection and no overflow at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockCatalog(page, { productCount: 12 });
    await page.goto('/catalog/products');
    await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search products' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Classic Smash/ })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/catalog-c1-browse-${viewport.width}.png`,
      fullPage: false,
      animations: 'disabled',
    });
  });
}
