import { expect, test } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const recordId = '44444444-4444-4444-8444-444444444444';

const samples = [
  {
    kind: 'refund',
    label: 'Posted return refund',
    drilldown: { type: 'ORDER', orderId: recordId },
    destination: '/orders/',
  },
  {
    kind: 'loyalty-event',
    label: 'Loyalty credited on order',
    drilldown: { type: 'ORDER', orderId: recordId },
    destination: '/orders/',
  },
  {
    kind: 'promotion-use',
    label: 'Promotion applied on order',
    drilldown: { type: 'ORDER', orderId: recordId },
    destination: '/orders/',
  },
  {
    kind: 'customer-segment',
    label: 'Customer joined VIP segment',
    drilldown: { type: 'CUSTOMER', customerId: recordId },
    destination: '/customers/',
  },
  {
    kind: 'staff-payment',
    label: 'Employee salary payment',
    drilldown: { type: 'STAFF', employeeId: recordId, section: 'pay' },
    destination: '/staff/',
  },
  {
    kind: 'finance-movement',
    label: 'Bank transfer entry',
    drilldown: {
      type: 'FINANCE_ACCOUNT',
      accountId: recordId,
      movementId: '55555555-5555-4555-8555-555555555555',
    },
    destination: '/finance/',
  },
  {
    kind: 'attendance-event',
    label: 'Employee clock in',
    drilldown: { type: 'STAFF', employeeId: recordId, section: 'attendance' },
    destination: '/staff/',
  },
  {
    kind: 'inventory-movement',
    label: 'Recorded ingredient use',
    drilldown: { type: 'INVENTORY_ITEM', inventoryItemId: recordId },
    destination: '/inventory/',
  },
  {
    kind: 'purchase-order',
    label: 'Supplier order',
    drilldown: { type: 'PURCHASE_ORDER', purchaseOrderId: recordId },
    destination: '/purchasing/',
  },
] as const;

for (const sample of samples) {
  test(`report ${sample.kind} navigates to exact canonical parent record`, async ({ page }) => {
    await page.setViewportSize(sample.kind === 'staff-payment' ? { width: 390, height: 844 } : { width: 1440, height: 960 });
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
              'reports.view',
              'finance.view',
              'orders.view',
              'inventory.view',
              'staff.view',
              'purchasing.view',
              'catalog.view',
              'customers.view',
            ],
          },
          csrfToken: 'a'.repeat(64),
        }),
      }),
    );
    await page.route('**/api/admin/reports**', async (route) => {
      const url = new URL(route.request().url());
      const view = url.searchParams.get('view');
      const payload =
        view === 'configuration'
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
                rows: [
                  {
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
                  },
                ],
                nextOffset: null,
              };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });
    });
    if (sample.kind === 'attendance-event' || sample.kind === 'staff-payment') {
      await page.route('**/api/admin/staff**', async (route) => {
        const url = new URL(route.request().url());
        const employee = {
          id: recordId,
          businessId: '33333333-3333-4333-8333-333333333333',
          displayName: 'Mona Ali',
          phone: '+201000000000',
          hireDate: null,
          notes: null,
          role: 'STAFF',
          active: true,
          profileVersion: 1,
          credentialVersion: 1,
          customPermissions: [],
          customDeniedPermissions: [],
          assignments: [{ shopId, assigned: true }],
          operationsIdentities: [{ kind: 'SETUP_REQUIRED', shopId }],
          compensation: [],
          shifts: [],
          attendanceEvents: [],
          attendanceCorrections: [],
          attendanceSummaries: [],
          leaveRequests: [],
          payments: [],
        };
        const body = url.searchParams.get('employeeId')
          ? { employee }
          : {
              employees: {
                rows: [{
                  id: recordId,
                  displayName: 'Mona Ali',
                  phone: employee.phone,
                  role: 'STAFF',
                  active: true,
                  shopIds: [shopId],
                  operationsSetupRequiredShopIds: [shopId],
                }],
                nextCursor: null,
              },
              workers: [],
              shops: [{ id: shopId, name: 'Authorized shop' }],
              financeAccounts: [],
            };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
    }
    if (sample.kind === 'customer-segment') {
      await page.route('**/api/admin/customers**', async (route) => {
        const view = new URL(route.request().url()).searchParams.get('view');
        const body = view === 'customer'
          ? { customer: {
              id: recordId,
              normalizedPhone: '+201012345678',
              displayName: 'Mona VIP',
              orderCount: 2,
              lifetimeSpendMinor: 5000,
              lastOrderAt: null,
              loyaltyBalance: 10,
              deliveryOrderCount: 0,
              segments: ['VIP'],
              linkedShops: [{ shopId, shopName: 'Authorized shop' }],
              addresses: [],
              loyaltyHistory: [],
            } }
          : view === 'customers'
            ? { customers: [] }
            : view === 'loyalty-program'
              ? { program: null }
              : { reasons: [] };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
    }
    if (sample.kind === 'loyalty-event' || sample.kind === 'promotion-use') {
      await page.route('**/api/admin/orders**', async (route) => {
        const url = new URL(route.request().url());
        const body = url.searchParams.get('orderId')
          ? {
              id: recordId, shopId, status: 'DONE', operationalRevision: 1, source: 'POS',
              displayOrderNo: 42, displayOrderLabel: '#42',
              createdAt: '2026-10-08T09:00:00.000Z', totalMinor: 2500,
              customer: null,
              fulfillment: {
                orderTypeLabel: 'Take away', behavior: 'TAKE_AWAY',
                address: null, deliveryZoneLabel: null, finalDeliveryFeeMinor: 0,
              },
              payments: [], items: [], statusHistory: [],
              financialEvents: [], inventoryMovements: [], auditEvents: [],
            }
          : { shopId, rows: [], nextCursor: null };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
    }
    await page.goto('/reports');
    const suffix = sample.kind === 'finance-movement'
      ? '?movementId=55555555-5555-4555-8555-555555555555'
      : sample.kind === 'attendance-event' ? '?section=attendance'
      : sample.kind === 'staff-payment' ? '?section=pay' : '';
    const expected = `${sample.destination}${recordId}${suffix}`;
    const link = sample.kind === 'staff-payment'
      ? page.getByRole('list', { name: 'Report entries' }).getByRole('link', { name: sample.label })
      : page.getByRole('table').getByRole('link', { name: sample.label });
    await expect(link).toHaveAttribute('href', expected);
    await link.click();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return url.pathname + url.search;
      })
      .toBe(expected);
    if (sample.kind === 'attendance-event' || sample.kind === 'staff-payment') {
      await expect(page.getByRole('article', { name: 'Employee Mona Ali' })).toBeVisible();
      const tab = sample.kind === 'attendance-event' ? 'Attendance' : 'Pay / Compensation';
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await page.reload();
      await expect(page.getByRole('article', { name: 'Employee Mona Ali' })).toBeVisible();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      await page.goBack();
      await expect(page).toHaveURL(/reports/);
    }
    if (sample.kind === 'customer-segment') {
      await expect(page.getByRole('article', { name: 'Customer Mona VIP' })).toBeVisible();
    }
    if (sample.kind === 'loyalty-event' || sample.kind === 'promotion-use') {
      await expect(page.getByLabel('Order detail')).toBeVisible();
      await expect(page.getByText('#42').first()).toBeVisible();
    }
  });
}
