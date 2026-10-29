import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
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
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken,
};

async function mockReports(page: Page) {
  const queries: URLSearchParams[] = [];
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
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
    if (url.searchParams.get('view') === 'filter-options') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          options: {
            paymentMethods: [{ id: '66666666-6666-4666-8666-666666666666', label: 'Cash' }],
            orderTypes: [{ id: '77777777-7777-4777-8777-777777777777', label: 'Takeaway' }],
          },
        }),
      });
      return;
    }
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
        rows: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            shopId,
            occurredAt: '2026-10-08T09:00:00.000Z',
            sourceKind: 'payment',
            label: 'Cash payment',
            amountMinor: 12500,
            quantity: 1,
            orderSource: 'POS',
            costMissing: false,
          },
        ],
        nextOffset: null,
        ...(compare
          ? {
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
            }
          : {}),
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
  await page.getByText('Filters', { exact: true }).click();
  await page.getByLabel('Order source').selectOption('POS');
  await expect.poll(() => queries.some((query) => query.get('source') === 'POS')).toBe(true);
  await page.getByLabel('Compare previous period').check();
  await expect
    .poll(() =>
      queries.some((query) => query.get('source') === 'POS' && query.get('compare') === 'previous'),
    )
    .toBe(true);
  await expect(page.getByText('Previous period recorded amount')).toBeVisible();
  await page.getByLabel('All reports').selectOption('expenses');
  await expect.poll(() => queries.some((query) => query.get('area') === 'expenses')).toBe(true);
});

test('contextual payment-method filter and comparison presets reach server', async ({ page }) => {
  const { queries } = await mockReports(page);
  await page.goto('/reports');
  await page.getByText('Filters', { exact: true }).click();
  await page.getByLabel('Payment method').selectOption('66666666-6666-4666-8666-666666666666');
  await expect
    .poll(() =>
      queries.some(
        (query) => query.get('paymentMethodId') === '66666666-6666-4666-8666-666666666666',
      ),
    )
    .toBe(true);
  await page.getByLabel('Compare previous period').check();
  await page.getByLabel('Comparison range').selectOption('week');
  await expect.poll(() => queries.some((query) => query.get('compare') === 'week')).toBe(true);
});

test('saved report views send one authorized CSRF-protected versioned command', async ({
  page,
}) => {
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

test('R2 failed Save View keeps modal and name until the server confirms persistence', async ({
  page,
}) => {
  await mockReports(page);
  await page.route('**/api/admin/reports**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const payload = route.request().postDataJSON() as { type?: string };
    if (payload.type !== 'report.view.save') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'report_version_conflict' }),
    });
  });
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Save this report view' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save report view' });
  await dialog.getByLabel('View name').fill('Weekly owner review');
  await dialog.getByRole('button', { name: 'Save view' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('View name')).toHaveValue('Weekly owner review');
  await expect(dialog.getByRole('alert')).toContainText('Unable to save');
});

test('R2 failed Set Target keeps target dialog open and preserves date window', async ({
  page,
}) => {
  await mockReports(page);
  await page.route('**/api/admin/reports**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const payload = route.request().postDataJSON() as { type?: string };
    if (payload.type !== 'report.target.set') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'report_target_conflict' }),
    });
  });
  await page.goto('/reports');
  await page.getByRole('button', { name: 'Set target' }).click();
  const dialog = page.getByRole('dialog', { name: 'Configure report target' });
  await dialog.getByLabel('From').fill('2026-10-01');
  await dialog.getByLabel('To').fill('2026-10-31');
  await dialog.getByRole('button', { name: 'Save target' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('From')).toHaveValue('2026-10-01');
  await expect(dialog.getByLabel('To')).toHaveValue('2026-10-31');
  await expect(dialog.getByRole('alert')).toBeVisible();
});

test('phone report presentation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReports(page);
  await page.goto('/reports');
  await expect(page.getByRole('list', { name: 'Report entries' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

for (const vp of premiumVisualViewports([
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
])) {
  test(`report table viewport ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockReports(page);
    await page.goto('/reports');
    if (vp.width <= 480) {
      await expect(page.getByRole('list', { name: 'Report entries' })).toBeVisible();
    } else {
      await expect(page.getByRole('table')).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'reports');
  });
}

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        test(`targeted P07 reports ${theme} ${entry} ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await mockReports(page);
          await verifyTargetedVisualLayout(page, {
            route: '/reports',
            heading: 'Reports',
            theme,
            entry,
          });
          await captureTargetedAcceptance(page, 'p07', 'reports', theme, entry);
        });
      }
    }
  }
}

test('Reports blocks an inverted date range instead of sending a misleading query', async ({
  page,
}) => {
  const { queries } = await mockReports(page);
  await page.goto('/reports');
  await expect(page.getByRole('table')).toBeVisible();
  await page
    .getByRole('region', { name: 'Report filters' })
    .getByLabel('From', { exact: true })
    .fill('2026-10-26');
  await page
    .getByRole('region', { name: 'Report filters' })
    .getByLabel('To', { exact: true })
    .fill('2026-10-01');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Select a valid From/To date range' }),
  ).toBeVisible();
  expect(
    queries.some(
      (params) =>
        (params.get('from') ?? '') > (params.get('to') ?? '') &&
        params.get('from') !== null &&
        params.get('to') !== null,
    ),
  ).toBe(false);
});

test('R4 current and all-authorized exports download real PDF responses with correct scope', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockReports(page);
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/reports**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.view !== 'pdf-export') {
      await route.fallback();
      return;
    }
    payloads.push(body);
    expect(route.request().headers()['x-tux-admin-csrf']).toBe(csrfToken);
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="tux-report.pdf"' },
      body: '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF',
    });
  });
  await page.goto('/reports');
  const first = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download report PDF' }).click();
  expect((await first).suggestedFilename()).toMatch(/tux-reports-current-.*\.pdf/);
  const second = page.waitForEvent('download');
  await page.getByRole('button', { name: 'All 22 reports (1 PDF)' }).click();
  expect((await second).suggestedFilename()).toMatch(/tux-reports-all-authorized-.*\.pdf/);
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toMatchObject({
    view: 'pdf-export',
    kind: 'current',
    area: 'sales',
    shopIds: [shopId],
  });
  expect(payloads[1]).toMatchObject({
    view: 'pdf-export',
    kind: 'all-authorized',
    context: {},
    source: null,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('R4 reversed report dates disable PDF export before any request', async ({ page }) => {
  await mockReports(page);
  await page.goto('/reports');
  await page
    .getByRole('region', { name: 'Report filters' })
    .getByLabel('From', { exact: true })
    .fill('2026-10-31');
  await page
    .getByRole('region', { name: 'Report filters' })
    .getByLabel('To', { exact: true })
    .fill('2026-10-01');
  await expect(page.getByRole('button', { name: 'Download report PDF' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'All 22 reports (1 PDF)' })).toBeDisabled();
});
