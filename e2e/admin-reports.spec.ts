import { expect, test, type Page } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const csrfToken = 'r'.repeat(64);
const session = {
  principal: {
    employeeId: '22222222-2222-4222-8222-222222222222',
    businessId: '33333333-3333-4333-8333-333333333333',
    role: 'OWNER',
    permissions: ['reports.view', 'settings.manage'],
    shopIds: [shopId],
  },
  csrfToken,
};

async function mockReports(page: Page) {
  const queries: URLSearchParams[] = [];
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
  });
  await page.route('**/api/admin/reports**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(url.pathname).toBe('/api/admin/reports');
    if (request.method() === 'POST') {
      expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
      const command = request.postDataJSON() as Record<string, unknown>;
      commands.push(command);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, id: shopId, version: 1 }),
      });
      return;
    }
    expect(url.searchParams.get('shopId')).toBe(shopId);
    if (url.searchParams.get('view') === 'configuration') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ savedViews: [], targets: [] }),
      });
      return;
    }
    queries.push(url.searchParams);
    const area = url.searchParams.get('area') ?? 'sales';
    const compare = url.searchParams.get('compare') === 'previous';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        area,
        summary: {
          eventCount: 1,
          orderCount: 1,
          totalAmountMinor: 12500,
          totalQuantity: 1,
          incompleteCostEvents: 0,
          coverageNote: null,
        },
        rows: [{
          id: '44444444-4444-4444-8444-444444444444',
          shopId,
          occurredAt: '2026-10-08T09:00:00.000Z',
          sourceKind: 'payment',
          label: 'Cash payment',
          amountMinor: 12500,
          quantity: 1,
          orderSource: 'POS',
          costMissing: false,
        }],
        nextOffset: null,
        ...(compare ? {
          comparison: {
            periodStart: '2026-10-07',
            periodEnd: '2026-10-07',
            summary: {
              eventCount: 1,
              orderCount: 1,
              totalAmountMinor: 9000,
              totalQuantity: 1,
              incompleteCostEvents: 0,
              coverageNote: null,
            },
          },
        } : {}),
      }),
    });
  });
  return { queries, commands };
}

test('reports preserve source filtering and period comparison on server-side requests', async ({
  page,
}) => {
  const { queries } = await mockReports(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByLabel('Order source').selectOption('POS');
  await expect.poll(() => queries.some((query) => query.get('source') === 'POS')).toBe(true);
  await page.getByLabel('Compare previous period').check();
  await expect.poll(() => queries.some((query) =>
    query.get('source') === 'POS' && query.get('compare') === 'previous')).toBe(true);
  await expect(page.getByText('Previous period recorded amount')).toBeVisible();
  await page.getByLabel('Report', { exact: true }).selectOption('expenses');
  await expect.poll(() => queries.some((query) => query.get('area') === 'expenses')).toBe(true);
});

test('saved report views send one authorized CSRF-protected versioned command', async ({ page }) => {
  const { commands } = await mockReports(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByRole('button', { name: 'Save this report view' }).click();
  await page.getByLabel('View name').fill('Daily cashier review');
  await page.getByRole('button', { name: 'Save view' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'report.view.save',
    shopId,
    id: null,
    expectedVersion: 0,
    name: 'Daily cashier review',
    reportArea: 'sales',
  });
  expect(commands[0]?.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});
