import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const masterProductId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ruleId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

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

type RecurringCommand = {
  type?: string;
  shopId?: string;
  ruleId?: string | null;
  masterProductId?: string;
  daysOfWeek?: number[];
  startLocal?: string;
  endLocal?: string;
  available?: boolean;
  active?: boolean;
  expectedVersion?: number | null;
};

async function mockRecurringAvailability(page: Page) {
  const commands: RecurringCommand[] = [];
  let rules = [
    {
      id: ruleId,
      shopId,
      masterProductId,
      timezone: 'Africa/Cairo',
      daysOfWeek: [5],
      startLocal: '22:00:00',
      endLocal: '02:00:00',
      available: true,
      active: true,
      version: 1,
      updatedAt: '2026-09-11T18:00:00.000Z',
    },
  ];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });

  await page.route('**/api/admin/catalog**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET' && url.searchParams.get('view') === 'publishing') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          currentPublishVersion: 48,
          versions: [
            {
              shopId,
              publishVersion: 48,
              operationsConfigurationVersion: 48,
              sourceKind: 'DRAFT',
              draftId: null,
              publishedByEmployeeId: ownerSession.principal.employeeId,
              restoredFromPublishVersion: null,
              publishedAt: '2026-09-11T17:00:00.000Z',
            },
          ],
          draftPreviews: [],
          schedules: [],
        }),
      });
      return;
    }

    if (request.method() === 'GET' && url.searchParams.get('view') === 'recurring-availability') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          products: [
            {
              masterProductId,
              productId,
              name: 'Classic Smash',
              manualSoldOut: false,
            },
          ],
          rules,
        }),
      });
      return;
    }

    if (request.method() === 'POST') {
      expect(request.headers()['x-tux-admin-csrf']).toBe(ownerSession.csrfToken);
      const body = request.postDataJSON() as RecurringCommand;
      commands.push(body);
      if (body.type === 'availability.recurring.save') {
        const nextVersion = body.ruleId === ruleId ? 2 : 1;
        if (body.ruleId === ruleId && body.active === false) {
          rules = rules.map((rule) =>
            rule.id === ruleId ? { ...rule, active: false, version: nextVersion } : rule,
          );
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            ruleId: body.ruleId ?? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            version: nextVersion,
            timezone: 'Africa/Cairo',
            active: body.active ?? true,
          }),
        });
        return;
      }
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected_catalog_request' }),
    });
  });

  return { commands };
}

test('recurring availability creates an overnight Cairo rule through the trusted BFF', async ({
  page,
}) => {
  const fixture = await mockRecurringAvailability(page);
  await page.goto('/catalog/products/publishing');

  await expect(page.getByRole('heading', { name: 'Recurring availability' })).toBeVisible();
  await expect(page.getByText('Africa/Cairo', { exact: true })).toBeVisible();

  await page.getByLabel('Product').selectOption(masterProductId);
  await page.getByRole('checkbox', { name: 'Friday' }).check();
  await page.getByLabel('Start time').fill('22:00');
  await page.getByLabel('End time').fill('02:00');
  await expect(page.getByText('Ends next day')).toBeVisible();
  await page.getByRole('button', { name: 'Save recurring rule' }).click();

  await expect(page.getByText('Recurring availability saved.')).toBeVisible();
  expect(fixture.commands.at(-1)).toEqual({
    type: 'availability.recurring.save',
    shopId,
    ruleId: null,
    masterProductId,
    daysOfWeek: [5],
    startLocal: '22:00',
    endLocal: '02:00',
    available: true,
    active: true,
    expectedVersion: null,
  });
});

test('recurring availability deactivates an existing rule with version fencing', async ({
  page,
}) => {
  const fixture = await mockRecurringAvailability(page);
  await page.goto('/catalog/products/publishing');

  await page.getByRole('button', { name: 'Deactivate recurring rule for Classic Smash' }).click();
  await expect(page.getByText('Recurring availability saved.')).toBeVisible();
  expect(fixture.commands.at(-1)).toMatchObject({
    type: 'availability.recurring.save',
    shopId,
    ruleId,
    masterProductId,
    active: false,
    expectedVersion: 1,
  });
});

test('recurring availability editor remains usable on phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRecurringAvailability(page);
  await page.goto('/catalog/products/publishing');

  await expect(page.getByRole('heading', { name: 'Recurring availability' })).toBeVisible();
  await expect(page.getByLabel('Product')).toBeVisible();
  await expect(page.getByLabel('Start time')).toBeVisible();
  await expect(page.getByLabel('End time')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save recurring rule' })).toBeVisible();
});
