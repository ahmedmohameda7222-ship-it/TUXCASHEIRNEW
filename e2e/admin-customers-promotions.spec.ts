import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  PREMIUM_EVIDENCE_VIEWPORTS,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShopId = '99999999-9999-4999-8999-999999999999';
const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mergedCustomerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const csrfToken = 'c'.repeat(64);
let postedCommands: Array<Record<string, unknown> & { type: string }> = [];

const session = {
  principal: {
    employeeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    businessId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    role: 'OWNER',
    permissions: ['customers.view', 'customers.merge', 'loyalty.manage', 'promotions.manage'],
    shopIds: [shopId],
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken,
};

const mergeCandidate = {
  id: mergedCustomerId,
  normalizedPhone: '+201099999999',
  displayName: 'Nour',
  orderCount: 2,
  lifetimeSpendMinor: 12_000,
  lastOrderAt: '2026-09-10T12:00:00.000Z',
  loyaltyBalance: 10,
  segments: ['Returning'],
};

test.beforeEach(async ({ page }) => {
  postedCommands = [];
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    }),
  );

  await page.route('**/api/admin/customers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
      const command = request.postDataJSON() as Record<string, unknown> & { type: string };
      postedCommands.push(command);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          command.type === 'customer.merge'
            ? {
                ok: true,
                survivorCustomerId: customerId,
                mergedCustomerId,
                replayed: false,
              }
            : command.type === 'loyalty.adjust'
              ? {
                  ok: true,
                  ledgerEventId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  balance: 130,
                  replayed: false,
                }
              : command.type === 'promotion.upsert'
                ? {
                    ok: true,
                    promotionId: '11111111-1111-4111-8111-111111111111',
                    version: 1,
                    replayed: false,
                  }
                : { ok: true, version: 4 },
        ),
      });
      return;
    }

    const view = url.searchParams.get('view');
    const search = url.searchParams.get('q')?.trim() ?? '';
    const payload =
      view === 'customers'
        ? {
            customers: search
              ? [mergeCandidate]
              : [
                  {
                    id: customerId,
                    normalizedPhone: '+201012345678',
                    displayName: 'Mona',
                    orderCount: 12,
                    lifetimeSpendMinor: 150000,
                    lastOrderAt: '2026-09-20T12:00:00.000Z',
                    loyaltyBalance: 120,
                    segments: ['Returning', 'VIP', 'Top Spenders'],
                  },
                ],
          }
        : view === 'customer'
          ? {
              customer: {
                id: customerId,
                normalizedPhone: '+201012345678',
                displayName: 'Mona',
                orderCount: 12,
                lifetimeSpendMinor: 150000,
                lastOrderAt: '2026-09-20T12:00:00.000Z',
                loyaltyBalance: 120,
                deliveryOrderCount: 5,
                segments: [
                  'Returning',
                  'VIP',
                  'Top Spenders',
                  'Frequent Delivery',
                  'Loyalty Members',
                ],
                linkedShops: [{ shopId, shopName: 'Maadi' }],
                addresses: [
                  {
                    id: '22222222-2222-4222-8222-222222222222',
                    shopId,
                    address: 'Road 9, Maadi',
                    deliveryZoneId: null,
                    lastUsedAt: '2026-09-20T12:00:00.000Z',
                  },
                ],
                loyaltyHistory: [
                  {
                    id: '33333333-3333-4333-8333-333333333333',
                    shopId,
                    orderId: null,
                    eventType: 'EARN',
                    pointsDelta: 20,
                    monetaryValueMinor: 0,
                    earnExpiresAt: null,
                    reason: null,
                    note: null,
                    sourceEventId: 'order-finalized',
                    createdAt: '2026-09-20T12:00:00.000Z',
                  },
                ],
              },
            }
          : view === 'loyalty-program'
            ? {
                program: {
                  businessId: session.principal.businessId,
                  enabled: false,
                  earnPointsPer100Minor: 3,
                  redemptionMinorPerPoint: 17,
                  minimumRedemptionPoints: 75,
                  pointExpiryDays: 180,
                  shopIds: [shopId, otherShopId],
                  version: 3,
                  updatedAt: '2026-09-20T12:00:00.000Z',
                },
              }
            : view === 'promotions'
              ? {
                  promotions: [
                    {
                      id: '44444444-4444-4444-8444-444444444444',
                      businessId: session.principal.businessId,
                      name: 'Lunch 10%',
                      active: true,
                      kind: 'PERCENT',
                      percentBasisPoints: 1000,
                      fixedDiscountMinor: null,
                      freeProductId: null,
                      startsAt: null,
                      endsAt: null,
                      minimumOrderMinor: 5000,
                      shopIds: [shopId, otherShopId],
                      channel: 'BOTH',
                      productIds: [],
                      categoryIds: [],
                      totalUsageLimit: 100,
                      perCustomerUsageLimit: 2,
                      stackingPolicy: 'ONE_ORDER_LEVEL',
                      version: 2,
                      updatedAt: '2026-09-20T12:00:00.000Z',
                    },
                  ],
                }
              : {
                  reasons: [
                    {
                      id: '55555555-5555-4555-8555-555555555555',
                      scope: 'BUSINESS',
                      key: 'SERVICE_RECOVERY',
                      family: 'DISCOUNT_COMP',
                      label: 'Service recovery',
                      active: true,
                      version: 1,
                    },
                  ],
                };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.route('**/api/admin/catalog**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shopId,
        currentPublishVersion: 1,
        categories: [
          {
            id: '66666666-6666-4666-8666-666666666666',
            shopId,
            name: 'Burgers',
            active: true,
            sortOrder: 1,
            slug: 'burgers',
            description: null,
          },
        ],
        products: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            shopId,
            categoryId: '66666666-6666-4666-8666-666666666666',
            name: 'TUX Burger',
            active: true,
            sortOrder: 1,
            slug: 'tux-burger',
            description: null,
            priceMinor: 12000,
            imageKey: null,
            family: null,
            bestSeller: true,
            soldOut: false,
            isCombo: false,
          },
        ],
        drafts: [],
      }),
    }),
  );
});

async function openCustomer(page: Page) {
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await page.getByRole('button', { name: /Mona/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
}

test('CRM1 approved mobile directory uses truthful loaded-only selectors and profile Back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/customers');
  const list = page.locator('.admin-master-detail__list');
  await expect(list.getByRole('searchbox', { name: 'Search customers' })).toBeVisible();
  await expect(list.getByRole('combobox', { name: 'All segments (loaded results)' })).toBeVisible();
  await expect(list.getByRole('combobox', { name: 'All loyalty (loaded results)' })).toBeVisible();
  await expect(list.getByRole('combobox', { name: 'Sort loaded customers' })).toBeVisible();
  await expect(list).toContainText('loaded');
  await expect(list.getByRole('button', { name: /Mona/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Customer detail' })).toBeHidden();
  await list.getByRole('button', { name: /Mona/ }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`));
  await expect(page.getByRole('link', { name: /back to customers/i })).toBeVisible();
  await expect(list).toBeHidden();
  await page.getByRole('link', { name: /back to customers/i }).click();
  await expect(list).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('CRM1 desktop directory exposes real scoped fact columns and loaded-only filtering', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/customers');
  const directory = page.locator('.admin-customers-directory');
  await expect(directory).toBeVisible();
  await expect(directory.getByText('Total spent')).toBeVisible();
  await expect(directory.getByText('Loyalty', { exact: true })).toBeVisible();
  await expect(
    directory.locator('.admin-customers-directory__columns').getByText('Last order'),
  ).toBeVisible();
  const sort = directory.getByRole('combobox', { name: 'Sort loaded customers' });
  await sort.selectOption('orders');
  await expect(directory.getByRole('button', { name: /Mona/ })).toContainText('12');
  const segment = directory.getByRole('combobox', {
    name: 'All segments (loaded results)',
  });
  await segment.selectOption('VIP');
  await expect(directory.getByRole('button', { name: /Mona/ })).toBeVisible();
  const loyalty = directory.getByRole('combobox', {
    name: 'All loyalty (loaded results)',
  });
  await loyalty.selectOption('none');
  await expect(directory.getByText('No customers match these loaded-data filters.')).toBeVisible();
  await loyalty.selectOption('all');
  await directory.getByRole('button', { name: /Mona/ }).click();
  await expect(directory.locator('.admin-customer-row.is-selected')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('CRM1 server search and shop switching never reuse customers from the prior shop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const scopedCalls: URL[] = [];
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...session,
        principal: {
          ...session.principal,
          shopIds: [shopId, otherShopId],
          shopSummaries: [
            ...session.principal.shopSummaries,
            {
              id: otherShopId,
              name: 'TUX Zamalek',
              active: true,
              temporaryClosed: false,
            },
          ],
        },
      }),
    }),
  );
  await page.route('**/api/admin/customers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.get('view') !== 'customers') {
      await route.fallback();
      return;
    }
    scopedCalls.push(url);
    if (url.searchParams.get('shopId') !== otherShopId) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        customers: [{ ...mergeCandidate, displayName: 'Zamalek Customer' }],
      }),
    });
  });
  await page.goto('/customers');
  const list = page.locator('.admin-master-detail__list');
  const search = list.getByRole('searchbox', { name: 'Search customers' });
  await expect(list.getByRole('button', { name: /Mona/ })).toBeVisible();
  await search.fill('Nour');
  await expect(list.getByRole('button', { name: /Nour/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Mona/ })).toHaveCount(0);
  await search.fill('');
  await expect(list.getByRole('button', { name: /Mona/ })).toBeVisible();

  await page.locator('.shop-switcher select').selectOption(otherShopId);
  await expect(list.getByRole('button', { name: /Zamalek Customer/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /Mona/ })).toHaveCount(0);
  const secondShopWasQueried = () =>
    scopedCalls.some((url) => url.searchParams.get('shopId') === otherShopId);
  await expect.poll(secondShopWasQueried).toBe(true);
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test('renders canonical CRM identity, loyalty history and automatic segments', async ({ page }) => {
  await openCustomer(page);

  await expect(page.getByLabel('Customer detail').getByText('+201012345678')).toBeVisible();
  await expect(page.getByLabel('Customer detail').getByText('VIP')).toBeVisible();
  await expect(page.getByLabel('Customer detail').getByText('Frequent Delivery')).toBeVisible();

  await page.getByRole('tab', { name: 'Addresses' }).click();
  await expect(page.getByText('Road 9, Maadi')).toBeVisible();

  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Maadi', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Loyalty' }).click();
  await expect(page.getByLabel('Customer loyalty').getByText('120 points')).toBeVisible();
  await expect(
    page.getByLabel('Customer loyalty').getByText('Points earned', { exact: true }),
  ).toBeVisible();

  await page.getByRole('tab', { name: 'CRM settings' }).click();
  await expect(page).toHaveURL(/\/customers\/settings$/);
  await expect(page.getByRole('heading', { name: 'Promotions' })).toBeVisible();
  await expect(page.getByText(/Lunch 10%/)).toBeVisible();
});

test('exposes controlled merge, loyalty configuration and full promotion editor', async ({
  page,
}) => {
  await openCustomer(page);

  await page.getByLabel('Customer detail').getByRole('button', { name: 'Merge customer' }).click();
  await page.getByLabel('Search merge candidates').fill('Nour');
  const candidates = page.locator('.admin-customer-merge-list');
  await expect(candidates).toBeVisible();
  expect(await candidates.evaluate((node) => getComputedStyle(node).display)).toBe('grid');
  await page.getByLabel('Merge candidates').getByRole('button', { name: /Nour/ }).click();
  await page.getByLabel('I reviewed both customers and want to merge them.').check();
  const mergeButton = page.getByRole('dialog').getByRole('button', { name: 'Merge customer' });
  await expect(mergeButton).toBeEnabled();
  await mergeButton.click();
  await expect
    .poll(() => postedCommands.some((command) => command.type === 'customer.merge'))
    .toBe(true);

  await page.getByRole('tab', { name: 'CRM settings' }).click();
  await expect(page.getByLabel('Minimum points to redeem')).toBeVisible();
  await expect(page.getByLabel('Point expiry (days)')).toBeVisible();

  await page.getByRole('button', { name: 'New promotion' }).click();
  await expect(page.getByLabel('Type')).toContainText('Percentage discount');
  await expect(page.getByLabel('Type')).toContainText('Fixed amount discount');
  await expect(page.getByLabel('Type')).toContainText('Free item');
  await expect(page.getByLabel('Minimum order (EGP)')).toBeVisible();
  await expect(page.getByLabel('Channel')).toBeVisible();
  await page.getByLabel('Applies to').selectOption('products');
  await expect(page.getByLabel('TUX Burger')).toBeVisible();
  await page.getByLabel('Applies to').selectOption('categories');
  await expect(page.getByLabel('Burgers')).toBeVisible();
  await expect(page.getByLabel('Total uses (optional)')).toBeVisible();
  await expect(page.getByLabel('Uses per customer (optional)')).toBeVisible();
  await expect(page.getByLabel('Can combine with other promotions?')).toBeVisible();
});

test('hydrates canonical loyalty values and preserves hidden multi-shop scopes on save', async ({
  page,
}) => {
  await page.goto('/customers');
  await page.getByRole('tab', { name: 'CRM settings' }).click();

  await expect(page.getByLabel('Enabled')).not.toBeChecked();
  await expect(page.getByLabel('Points earned per 1 EGP')).toHaveValue('3');
  await expect(page.getByLabel('Point value (EGP)')).toHaveValue('0.17');
  await expect(page.getByLabel('Minimum points to redeem')).toHaveValue('75');
  await expect(page.getByLabel('Point expiry (days)')).toHaveValue('180');
  const savedPolicy = page.getByRole('region', { name: 'Current saved loyalty settings' });
  await expect(savedPolicy).toContainText('75 points');
  await expect(savedPolicy).toContainText('Disabled');

  await page.getByLabel('Minimum points to redeem').fill('80');
  await expect(savedPolicy).toContainText('75 points');
  await page.getByRole('button', { name: 'Save loyalty program' }).click();

  await expect
    .poll(() => postedCommands.some((command) => command.type === 'loyalty.program.upsert'))
    .toBe(true);
  const loyaltyCommand = postedCommands.find(
    (command) => command.type === 'loyalty.program.upsert',
  );
  expect(loyaltyCommand).toMatchObject({
    type: 'loyalty.program.upsert',
    shopId,
    enabled: false,
    earnPointsPer100Minor: 3,
    redemptionMinorPerPoint: 17,
    minimumRedemptionPoints: 80,
    pointExpiryDays: 180,
    shopIds: [shopId, otherShopId],
    expectedVersion: 3,
  });

  await page.getByRole('button', { name: /Lunch 10%/ }).click();
  await page.getByLabel('Name').fill('Lunch scoped edit');
  await page.getByRole('button', { name: 'Save promotion' }).click();

  await expect
    .poll(() => postedCommands.some((command) => command.type === 'promotion.upsert'))
    .toBe(true);
  const promotionCommand = postedCommands.find((command) => command.type === 'promotion.upsert');
  expect(promotionCommand).toMatchObject({
    type: 'promotion.upsert',
    promotion: {
      name: 'Lunch scoped edit',
      shopIds: [shopId, otherShopId],
    },
  });
});

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`customer CRM remains usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/customers');
    const list = page.locator('.admin-master-detail__list');
    await list.getByRole('button', { name: /Mona/ }).click();
    await expect(page.locator('.admin-master-detail__detail')).toBeVisible();
    const metrics = page.locator('.admin-customer-detail__metrics').first();
    await expect(metrics).toBeVisible();
    expect(await metrics.evaluate((node) => getComputedStyle(node).display)).toBe('grid');
    const tabs = page.getByRole('tablist', { name: 'Customer detail sections' });
    await expect(tabs.getByRole('tab')).toHaveCount(5);
    expect(
      await tabs.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return [...node.querySelectorAll('[role="tab"]')].every((tab) => {
          const r = tab.getBoundingClientRect();
          return r.left >= bounds.left - 1 && r.right <= bounds.right + 1;
        });
      }),
    ).toBe(true);
    const segmentTags = page.locator('.admin-customer-segments__tag');
    await expect(segmentTags.first()).toBeVisible();
    // Flex items are blockified by the browser, so inline-flex computes as flex.
    expect(await segmentTags.first().evaluate((node) => getComputedStyle(node).display)).toMatch(
      /^(inline-)?flex$/,
    );
    if (viewport.width <= 480) {
      await expect(list).toBeHidden();
      await expect(page.getByRole('link', { name: /back to customers/i })).toBeVisible();
    } else {
      await expect(list).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'crm');
  });
}

if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    test(`CRM settings saved vs draft scene at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto('/customers');
      await page.getByRole('tab', { name: 'CRM settings' }).click();
      await expect(
        page.getByRole('region', { name: 'Current saved loyalty settings' }),
      ).toContainText('75 points');
      await expect(page.getByLabel('Minimum points to redeem')).toHaveValue('75');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await capturePremiumScreenshot(page, 'crm-settings');
    });
  }
}

if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    test('customer empty scene at ' + viewport.width + 'px', async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.route('**/api/admin/customers**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'GET' && url.searchParams.get('view') === 'customers') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ customers: [] }),
          });
          return;
        }
        await route.fallback();
      });
      await page.goto('/customers');
      await expect(page.getByText('No matching customers')).toBeVisible();
      await expect(page.getByRole('button', { name: /Mona/ })).toHaveCount(0);
      await capturePremiumScreenshot(page, 'crm-empty');
    });
  }
}

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        test(`targeted P05 crm ${theme} ${entry} ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });

          await verifyTargetedVisualLayout(page, {
            route: '/customers',
            heading: 'Customers',
            theme,
            entry,
          });
          await captureTargetedAcceptance(page, 'p05', 'crm', theme, entry);
        });
      }
    }
  }
}

test('CRM refuses a false success when the server returns an application-level rejection', async ({
  page,
}) => {
  await page.route('**/api/admin/customers**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as { type?: string };
    if (command.type !== 'loyalty.program.upsert') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'loyalty_policy_version_conflict' }),
    });
  });
  await page.goto('/customers');
  await page.getByRole('tab', { name: 'CRM settings' }).click();
  await expect(page.getByLabel('Minimum points to redeem')).toHaveValue('75');
  await page.getByLabel('Minimum points to redeem').fill('80');
  await page.getByRole('button', { name: 'Save loyalty program' }).click();
  await expect(page.getByText('Loyalty settings could not be saved')).toBeVisible();
  await expect(page.getByText('Loyalty settings saved', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Minimum points to redeem')).toHaveValue('80');
});

test('background policy refresh preserves unsaved CRM settings edits for the current shop', async ({
  page,
}) => {
  let policyReads = 0;
  await page.route('**/api/admin/customers**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.get('view') !== 'loyalty-program') {
      await route.fallback();
      return;
    }
    policyReads += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        program: {
          businessId: session.principal.businessId,
          enabled: false,
          earnPointsPer100Minor: 3,
          redemptionMinorPerPoint: 17,
          minimumRedemptionPoints: 75,
          pointExpiryDays: 180,
          shopIds: [shopId, otherShopId],
          version: 3,
          updatedAt: policyReads === 1 ? '2026-09-20T12:00:00Z' : '2026-09-20T12:01:00Z',
        },
      }),
    });
  });
  await page.goto('/customers/settings');
  const minimum = page.getByLabel('Minimum points to redeem');
  await expect(minimum).toHaveValue('75');
  await minimum.fill('80');

  await page.getByRole('button', { name: 'Refresh saved loyalty settings' }).click();
  await expect.poll(() => policyReads).toBeGreaterThan(1);
  await expect(minimum).toHaveValue('80');
  await expect(page.getByRole('region', { name: 'Current saved loyalty settings' })).toContainText(
    '75 points',
  );
});
