import { expect, test } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const recordId = '44444444-4444-4444-8444-444444444444';

const samples = [
  { kind: 'refund', label: 'Posted return refund',
    drilldown: { type: 'ORDER', orderId: recordId }, destination: '/orders/' },
  { kind: 'finance-movement', label: 'Bank transfer entry',
    drilldown: { type: 'FINANCE_ACCOUNT', accountId: recordId, movementId: '55555555-5555-4555-8555-555555555555' }, destination: '/finance/' },
  { kind: 'attendance-event', label: 'Employee clock in',
    drilldown: { type: 'STAFF', employeeId: recordId, section: 'attendance' }, destination: '/staff/' },
  { kind: 'inventory-movement', label: 'Recorded ingredient use',
    drilldown: { type: 'INVENTORY_ITEM', inventoryItemId: recordId }, destination: '/inventory/' },
  { kind: 'purchase-order', label: 'Supplier order',
    drilldown: { type: 'PURCHASE_ORDER', purchaseOrderId: recordId }, destination: '/purchasing/' },
] as const;

for (const sample of samples) {
  test(`report ${sample.kind} navigates to exact canonical parent record`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.route('**/api/admin/session', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          principal: {
            employeeId: '22222222-2222-4222-8222-222222222222',
            businessId: '33333333-3333-4333-8333-333333333333',
            role: 'OWNER',
            shopIds: [shopId],
            permissions: [
              'reports.view','finance.view','orders.view','inventory.view',
              'staff.view','purchasing.view','catalog.view','customers.view',
            ],
          },
          csrfToken: 'a'.repeat(64),
        }),
      }),
    );
    await page.route('**/api/admin/reports**', async (route) => {
      const url = new URL(route.request().url());
      const view = url.searchParams.get('view');
      const payload = view === 'configuration'
        ? { savedViews: [], targets: [] }
        : view === 'filter-options'
          ? { options: {} }
          : {
              ok: true,
              area: 'sales',
              summary: {
                eventCount: 1,
                orderCount: 1,
                totalAmountMinor: 2500,
                totalQuantity: 1,
                incompleteCostEvents: 0,
                coverageNote: null,
              },
              rows: [{
                id: '66666666-6666-4666-8666-666666666666',
                shopId,
                sourceKind: sample.kind,
                label: sample.label,
                occurredAt: '2026-10-08T09:00:00.000Z',
                amountMinor: 2500,
                quantity: 1,
                orderSource: null,
                costMissing: false,
                drilldown: sample.drilldown,
              }],
              nextOffset: null,
            };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
    });
    await page.goto('/reports');
    const suffix = sample.kind === 'finance-movement'
      ? '?movementId=55555555-5555-4555-8555-555555555555'
      : '';
    const expected = `${sample.destination}${recordId}${suffix}`;
    const link = page.getByRole('table').getByRole('link', { name: sample.label });
    await expect(link).toHaveAttribute('href', expected);
    await link.click();
    await expect.poll(() => {
      const url = new URL(page.url());
      return url.pathname + url.search;
    }).toBe(expected);
  });
}
