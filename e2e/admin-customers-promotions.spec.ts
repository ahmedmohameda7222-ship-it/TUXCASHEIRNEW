import { expect, test } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherShopId = '99999999-9999-4999-8999-999999999999';
const customerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const csrfToken = 'c'.repeat(64);
let postedCommands: Array<Record<string, unknown> & { type: string }> = [];

const session = {
  principal: {
    employeeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    businessId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    role: 'OWNER',
    permissions: ['customers.view', 'customers.merge', 'loyalty.manage', 'promotions.manage'],
    shopIds: [shopId],
  },
  csrfToken,
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
      const command = request.postDataJSON() as Record<string, unknown> & {
        type: string;
      };
      postedCommands.push(command);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          command.type === 'customer.merge'
            ? {
                ok: true,
                survivorCustomerId: customerId,
                mergedCustomerId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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
    const payload =
      view === 'customers'
        ? {
            customers: [
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
              : { reasons: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
});

test('renders canonical CRM identity, loyalty history and automatic segments', async ({ page }) => {
  await page.goto('/customers');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByLabel('Customer detail').getByText('+201012345678')).toBeVisible();
  await expect(page.getByText('Road 9, Maadi')).toBeVisible();
  await expect(page.getByText('VIP')).toBeVisible();
  await expect(page.getByText('Frequent Delivery')).toBeVisible();
  await expect(page.getByLabel('Customer loyalty').getByText('120 points')).toBeVisible();
  await expect(
    page.getByLabel('Customer loyalty').getByText('EARN', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Promotions' })).toBeVisible();
  await expect(page.getByText(/Lunch 10%/)).toBeVisible();
});

test('exposes controlled merge, loyalty configuration and full promotion editor', async ({
  page,
}) => {
  await page.goto('/customers');

  await page
    .getByLabel('Customer ID to merge into this survivor')
    .fill('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await page.getByLabel('Confirm canonical merge').check();
  await expect(page.getByRole('button', { name: 'Merge customer' }).last()).toBeEnabled();

  await expect(page.getByLabel('Minimum redemption points')).toBeVisible();
  await expect(page.getByLabel('Point expiry days')).toBeVisible();

  await page.getByRole('button', { name: 'New promotion' }).click();
  await expect(page.getByLabel('Type')).toContainText('PERCENT');
  await expect(page.getByLabel('Type')).toContainText('FIXED');
  await expect(page.getByLabel('Type')).toContainText('FREE_ITEM');
  await expect(page.getByLabel('Minimum order')).toBeVisible();
  await expect(page.getByLabel('Channel')).toBeVisible();
  await expect(page.getByLabel('Product restrictions')).toBeVisible();
  await expect(page.getByLabel('Category restrictions')).toBeVisible();
  await expect(page.getByLabel('Total usage limit')).toBeVisible();
  await expect(page.getByLabel('Per-customer usage limit')).toBeVisible();
  await expect(page.getByLabel('Stacking policy')).toBeVisible();
});

test(
  'hydrates canonical loyalty values and preserves hidden multi-shop scopes on save',
  async ({ page }) => {
    await page.goto('/customers');

    await expect(page.getByLabel('Enabled')).not.toBeChecked();
    await expect(page.getByLabel('Earn points per 1 EGP')).toHaveValue('3');
    await expect(page.getByLabel('Redemption minor per point')).toHaveValue('17');
    await expect(page.getByLabel('Minimum redemption points')).toHaveValue('75');
    await expect(page.getByLabel('Point expiry days')).toHaveValue('180');

    await page.getByLabel('Minimum redemption points').fill('80');
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
    const promotionCommand = postedCommands.find(
      (command) => command.type === 'promotion.upsert',
    );
    expect(promotionCommand).toMatchObject({
      type: 'promotion.upsert',
      promotion: {
        name: 'Lunch scoped edit',
        shopIds: [shopId, otherShopId],
      },
    });
  },
);
