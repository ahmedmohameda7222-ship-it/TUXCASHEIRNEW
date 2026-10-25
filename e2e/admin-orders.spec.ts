import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  PREMIUM_EVIDENCE_VIEWPORTS,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
import type { AdminOrderDetail, AdminOrderSummary } from '@tux/admin-contracts';
import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activeOrderId = '11111111-1111-4111-8111-111111111111';
const doneOrderId = '22222222-2222-4222-8222-222222222222';
const paymentId = '33333333-3333-4333-8333-333333333333';
const activeItemId = '44444444-4444-4444-8444-444444444444';
const doneItemId = '55555555-5555-4555-8555-555555555555';
const cancellationReasonId = '66666666-6666-4666-8666-666666666666';
const refundReasonId = '77777777-7777-4777-8777-777777777777';
const returnReasonId = '88888888-8888-4888-8888-888888888888';
const inactiveCancellationReasonId = '99999999-9999-4999-8999-999999999999';
const csrfToken = 'o'.repeat(64);

const ownerSession = {
  principal: {
    employeeId: 'abababab-abab-4bab-8bab-abababababab',
    businessId: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
    role: 'OWNER',
    permissions: ['orders.view', 'orders.cancel', 'orders.refund'],
    shopIds: [shopId],
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken,
};

function detail(input: {
  id: string;
  status: AdminOrderDetail['status'];
  source: AdminOrderDetail['source'];
  displayOrderNo: number;
  customerName: string;
  phone: string;
  itemId: string;
}): AdminOrderDetail {
  return {
    id: input.id,
    shopId,
    status: input.status,
    operationalRevision: input.status === 'ACTIVE' ? 4 : 7,
    source: input.source,
    displayOrderNo: input.displayOrderNo,
    displayOrderLabel: `#${input.displayOrderNo}`,
    createdAt: '2026-09-21T03:00:00.000Z',
    totalMinor: 12500,
    customer: {
      contactId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
      name: input.customerName,
      normalizedPhone: input.phone,
    },
    fulfillment: {
      orderTypeLabel: input.source === 'ONLINE' ? 'Delivery' : 'Take away',
      behavior: input.source === 'ONLINE' ? 'DELIVERY' : 'TAKE_AWAY',
      address: input.source === 'ONLINE' ? 'Road 9, Maadi' : null,
      deliveryZoneLabel: input.source === 'ONLINE' ? 'Maadi' : null,
      finalDeliveryFeeMinor: input.source === 'ONLINE' ? 1500 : 0,
    },
    payments:
      input.status === 'ACTIVE'
        ? []
        : [
            {
              id: paymentId,
              methodLabel: 'Cash',
              logicType: 'CASH',
              allocatedMinor: 12500,
              receivedMinor: 12500,
              changeMinor: 0,
              refundAllowedSnapshot: true,
              postedRefundMinor: 0,
              pendingRefundMinor: 0,
              remainingRefundableMinor: 12500,
            },
          ],
    items: [
      {
        id: input.itemId,
        productId: 'dededede-dede-4ede-8ede-dededededede',
        productName: 'TUX Burger',
        quantity: 1,
        unitPriceMinor: 12500,
        postedReturnQuantity: 0,
        pendingReturnQuantity: 0,
        remainingReturnableQuantity: 1,
        itemNote: null,
        modifiers: [],
        comboBeverages: [],
      },
    ],
    statusHistory: [
      {
        id: `status-${input.id}`,
        eventType: input.status === 'DONE' ? 'MARKED_DONE' : 'PLACED',
        operationalRevision: input.status === 'DONE' ? 7 : 0,
        fromStatus: input.status === 'DONE' ? 'ACTIVE' : null,
        toStatus: input.status,
        workerName: 'Ahmed',
        adminEmployeeId: null,
        reason: null,
        note: null,
        createdAt: '2026-09-21T03:00:00.000Z',
      },
    ],
    financialEvents: [],
    inventoryMovements: [],
    auditEvents: [],
  };
}

function summary(order: AdminOrderDetail): AdminOrderSummary {
  return {
    id: order.id,
    shopId: order.shopId,
    status: order.status,
    operationalRevision: order.operationalRevision,
    source: order.source,
    displayOrderNo: order.displayOrderNo,
    displayOrderLabel: order.displayOrderLabel,
    createdAt: order.createdAt,
    totalMinor: order.totalMinor,
    customerName: order.customer?.name ?? null,
    normalizedPhone: order.customer?.normalizedPhone ?? null,
    orderTypeLabel: order.fulfillment?.orderTypeLabel ?? 'Take away',
  };
}

async function mockOrders(
  page: Page,
  options: {
    staleCancellation?: boolean;
    emptyOrders?: boolean;
    paidActive?: boolean;
    financeVisible?: boolean;
    paginate?: boolean;
  } = {},
) {
  let active = detail({
    id: activeOrderId,
    status: 'ACTIVE',
    source: 'POS',
    displayOrderNo: 101,
    customerName: 'Ahmed',
    phone: '+201000000001',
    itemId: activeItemId,
  });
  let done = detail({
    id: doneOrderId,
    status: 'DONE',
    source: 'ONLINE',
    displayOrderNo: 102,
    customerName: 'Mona',
    phone: '+201000000002',
    itemId: doneItemId,
  });
  if (options.paidActive) active = { ...active, payments: done.payments };
  const commands: Record<string, unknown>[] = [];
  const searches: URL[] = [];
  const kpiRequests: URL[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.financeVisible
          ? {
              ...ownerSession,
              principal: {
                ...ownerSession.principal,
                permissions: [...ownerSession.principal.permissions, 'finance.view'],
              },
            }
          : ownerSession,
      ),
    });
  });

  await page.route('**/api/admin/reauth', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-tux-admin-csrf']).toBe(csrfToken);
    expect(route.request().postDataJSON()).toEqual({ pin: '1234' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reauthenticatedAt: '2026-09-23T06:00:00.000Z' }),
    });
  });

  await page.route('**/api/admin/orders**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET') {
      expect(url.searchParams.get('shopId')).toBe(shopId);
      if (url.searchParams.get('view') === 'kpis') {
        kpiRequests.push(url);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            shopId,
            orderCount: options.emptyOrders ? 0 : 65,
            activeOrderCount: options.emptyOrders ? 0 : 7,
            netSalesMinor: options.financeVisible ? (options.emptyOrders ? 0 : 471550) : null,
            averageOrderMinor: options.financeVisible && !options.emptyOrders ? 7918 : null,
            denominatorPaidOrderCount: options.financeVisible
              ? options.emptyOrders
                ? 0
                : 58
              : null,
          }),
        });
        return;
      }
      if (url.searchParams.get('view') === 'action-reasons') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            reasons: [
              {
                id: cancellationReasonId,
                scope: 'BUSINESS',
                key: 'CUSTOMER_REQUEST',
                family: 'CANCELLATION',
                label: 'Customer request',
                active: true,
                version: 4,
              },
              {
                id: inactiveCancellationReasonId,
                scope: 'BUSINESS',
                key: 'OLD_REASON',
                family: 'CANCELLATION',
                label: 'Inactive cancellation',
                active: false,
                version: 1,
              },
              {
                id: refundReasonId,
                scope: 'BUSINESS',
                key: 'CUSTOMER_REFUND',
                family: 'REFUND_RETURN',
                label: 'Customer requested refund',
                active: true,
                version: 3,
              },
              {
                id: returnReasonId,
                scope: 'BUSINESS',
                key: 'QUALITY_ISSUE',
                family: 'REFUND_RETURN',
                label: 'Quality issue',
                active: true,
                version: 5,
              },
            ],
          }),
        });
        return;
      }

      const requestedOrderId = url.searchParams.get('orderId');
      if (requestedOrderId) {
        const selected =
          requestedOrderId === active.id ? active : requestedOrderId === done.id ? done : null;
        await route.fulfill({
          status: selected ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(selected ?? { error: 'order_not_found' }),
        });
        return;
      }

      searches.push(url);
      const term = (url.searchParams.get('q') ?? '').toLowerCase();
      const statuses = url.searchParams.getAll('status');
      const source = url.searchParams.get('source');
      const rows = (options.emptyOrders ? [] : [active, done])
        .filter((order) => statuses.length === 0 || statuses.includes(order.status))
        .filter((order) => !source || order.source === source)
        .filter((order) => {
          if (!term) return true;
          return [order.displayOrderLabel, order.customer?.name, order.customer?.normalizedPhone]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term));
        })
        .map(summary);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          shopId,
          rows: options.paginate
            ? rows.slice(
                url.searchParams.get('cursor') === 'orders-next-2' ? 1 : 0,
                url.searchParams.get('cursor') === 'orders-next-2' ? 2 : 1,
              )
            : rows,
          nextCursor:
            options.paginate && !url.searchParams.get('cursor') && rows.length > 1
              ? 'orders-next-2'
              : null,
        }),
      });
      return;
    }

    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as Record<string, unknown>;
    commands.push(command);

    if (command.type === 'order.cancel') {
      if (command.reasonCodeId !== cancellationReasonId) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_reason_code' }),
        });
        return;
      }
      if (options.staleCancellation) {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'stale_operational_revision',
            canonicalStatus: 'DONE',
            canonicalOperationalRevision: 5,
          }),
        });
        return;
      }
      const nextRevision = active.operationalRevision + 1;
      active = {
        ...active,
        status: 'CANCELLED',
        operationalRevision: nextRevision,
        statusHistory: [
          ...active.statusHistory,
          {
            id: 'efefefef-efef-4fef-8fef-efefefefefef',
            eventType: 'CANCELLED',
            operationalRevision: nextRevision,
            fromStatus: 'ACTIVE',
            toStatus: 'CANCELLED',
            workerName: null,
            adminEmployeeId: ownerSession.principal.employeeId,
            reason: {
              id: cancellationReasonId,
              key: 'CUSTOMER_REQUEST',
              label: 'Customer request',
              family: 'CANCELLATION',
              configurationVersion: 4,
            },
            note: String(command.note ?? ''),
            createdAt: '2026-09-23T06:05:00.000Z',
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          orderId: active.id,
          status: 'CANCELLED',
          operationalRevision: nextRevision,
          lifecycleCursor: 44,
          replayed: false,
        }),
      });
      return;
    }

    if (command.type === 'order.refund') {
      if (command.reasonCodeId !== refundReasonId && command.reasonCodeId !== returnReasonId) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_reason_code' }),
        });
        return;
      }
      const reason =
        command.reasonCodeId === returnReasonId
          ? { id: returnReasonId, key: 'QUALITY_ISSUE', label: 'Quality issue', version: 5 }
          : {
              id: refundReasonId,
              key: 'CUSTOMER_REFUND',
              label: 'Customer requested refund',
              version: 3,
            };
      done = {
        ...done,
        financialEvents: [
          ...done.financialEvents,
          {
            id: '10101010-1010-4010-8010-101010101010',
            kind: 'REFUND',
            state: 'PENDING_APPROVAL',
            amountMinor: Number(command.amountMinor),
            approvalRequestId: '11111111-aaaa-4111-8111-111111111111',
            reason: {
              id: reason.id,
              key: reason.key,
              label: reason.label,
              family: 'REFUND_RETURN',
              configurationVersion: reason.version,
            },
            note: typeof command.note === 'string' ? command.note : null,
            createdAt: '2026-09-23T06:10:00.000Z',
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          orderId: done.id,
          refundId: '10101010-1010-4010-8010-101010101010',
          state: 'PENDING_APPROVAL',
          approvalRequestId: '11111111-aaaa-4111-8111-111111111111',
          replayed: false,
        }),
      });
      return;
    }

    if (command.type === 'order.return') {
      if (command.reasonCodeId !== refundReasonId && command.reasonCodeId !== returnReasonId) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'invalid_reason_code' }),
        });
        return;
      }
      const reason =
        command.reasonCodeId === returnReasonId
          ? { id: returnReasonId, key: 'QUALITY_ISSUE', label: 'Quality issue', version: 5 }
          : {
              id: refundReasonId,
              key: 'CUSTOMER_REFUND',
              label: 'Customer requested refund',
              version: 3,
            };
      done = {
        ...done,
        financialEvents: [
          ...done.financialEvents,
          {
            id: '12121212-1212-4121-8121-121212121212',
            kind: 'RETURN',
            state: 'POSTED',
            amountMinor: 12500,
            approvalRequestId: null,
            reason: {
              id: reason.id,
              key: reason.key,
              label: reason.label,
              family: 'REFUND_RETURN',
              configurationVersion: reason.version,
            },
            note: typeof command.note === 'string' ? command.note : null,
            createdAt: '2026-09-23T06:12:00.000Z',
          },
        ],
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          orderId: done.id,
          returnId: '12121212-1212-4121-8121-121212121212',
          state: 'POSTED',
          replayed: false,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unsupported_order_command' }),
    });
  });

  return {
    commands,
    searches,
    kpiRequests,
    get active() {
      return active;
    },
    get done() {
      return done;
    },
  };
}

test('orders search filters real Admin list and exposes status-contextual actions', async ({
  page,
}) => {
  const fixture = await mockOrders(page);
  await page.goto('/orders');

  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await page.getByRole('button', { name: /#101/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  await page.getByRole('button', { name: /#102/ }).click();
  await expect(page.getByRole('button', { name: 'Refund payment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return items' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  // The approved Orders view keeps search immediately available; filters remain a disclosure.
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeVisible();
  await page.getByText('Search and filters', { exact: true }).click();
  await page.getByLabel('Search').fill('Mona');
  await page.getByRole('combobox', { name: 'Status' }).first().selectOption('DONE');
  await page.getByRole('combobox', { name: 'Source' }).first().selectOption('ONLINE');

  await expect
    .poll(() =>
      fixture.searches.some(
        (url) =>
          url.searchParams.get('q') === 'Mona' &&
          url.searchParams.getAll('status').includes('DONE') &&
          url.searchParams.get('source') === 'ONLINE',
      ),
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: /#102/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /#101/ })).toHaveCount(0);
});

test('paid ACTIVE order blocks Admin cancellation while keeping immutable payments visible', async ({
  page,
}) => {
  const fixture = await mockOrders(page, { paidActive: true });
  await page.goto('/orders');
  await page.getByRole('button', { name: /#101/ }).click();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await expect(
    page.getByRole('status', { name: 'Paid active order cancellation restriction' }),
  ).toBeVisible();
  expect(fixture.commands).toHaveLength(0);
});

for (const viewport of premiumVisualViewports([{ name: 'desktop', width: 1440, height: 900 }])) {
  test(
    'ACTIVE cancellation uses a valid central reason at ' + viewport.width + 'px',
    async ({ page }) => {
      await page.setViewportSize(viewport);
      const fixture = await mockOrders(page);
      await page.goto('/orders');
      await page.getByRole('button', { name: /#101/ }).click();

      await page.getByRole('button', { name: 'Cancel order' }).click();
      const reason = page.getByLabel('Cancellation reason');
      await expect(reason.locator('option')).toHaveCount(1);
      await expect(reason.locator(`option[value="${cancellationReasonId}"]`)).toHaveText(
        'Customer request',
      );
      await expect(reason.locator(`option[value="${refundReasonId}"]`)).toHaveCount(0);
      await expect(reason.locator(`option[value="${inactiveCancellationReasonId}"]`)).toHaveCount(
        0,
      );

      await page.getByLabel('Note').fill('Customer called the shop');
      await capturePremiumScreenshot(page, 'order-cancel');
      await page.getByLabel('Admin PIN').fill('1234');
      await page.getByRole('button', { name: 'Confirm cancellation' }).click();

      await expect.poll(() => fixture.commands.length).toBe(1);
      expect(fixture.commands[0]).toMatchObject({
        type: 'order.cancel',
        shopId,
        orderId: activeOrderId,
        expectedOperationalRevision: 4,
        reasonCodeId: cancellationReasonId,
        note: 'Customer called the shop',
      });

      const detail = page.getByLabel('Order detail');
      await expect(detail.getByText(/Cancelled · In-store/).last()).toBeVisible();
      await expect(detail.getByText(/Customer request/)).toBeVisible();
    },
  );
}

test('stale operational revision conflict is surfaced without pretending cancellation succeeded', async ({
  page,
}) => {
  await mockOrders(page, { staleCancellation: true });
  await page.goto('/orders');
  await page.getByRole('button', { name: /#101/ }).click();

  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();

  await expect(page.getByRole('alert')).toContainText(/stale operational revision/i);
  await expect(
    page
      .getByLabel('Order detail')
      .getByText(/Active · In-store/)
      .last(),
  ).toBeVisible();
});

test('DONE refund and return preserve reason snapshots and pending approval state in detail', async ({
  page,
}) => {
  const fixture = await mockOrders(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /#102/ }).click();

  await page.getByRole('button', { name: 'Refund payment' }).click();
  await page.getByLabel('Reason').selectOption(refundReasonId);
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByRole('button', { name: 'Submit refund' }).click();

  await expect.poll(() => fixture.done.financialEvents.length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const detail = page.getByLabel('Order detail');
  await expect(detail.getByText('Refund', { exact: true })).toBeVisible();
  await expect(detail.getByText(/Pending Approval · Customer requested refund/)).toBeVisible();

  await page.getByRole('button', { name: 'Return items' }).click();
  await page.getByLabel('Reason').selectOption(returnReasonId);
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByLabel('Return quantity for TUX Burger').fill('1');
  await page.getByRole('button', { name: 'Return selected items' }).click();

  await expect.poll(() => fixture.done.financialEvents.length).toBe(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(detail.getByText('Return', { exact: true })).toBeVisible();
  await expect(detail.getByText(/Posted · Quality issue/)).toBeVisible();
});

const otherShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherShopOrderId = 'aaaaaaaa-1111-4111-8111-aaaaaaaa1111';

// These responses deliberately model two independently authorized shops. They
// never write an order or call production endpoints.
async function mockScopedOrderHistory(
  page: Page,
  options: { role?: 'OWNER' | 'MANAGER'; emptySecondShop?: boolean } = {},
) {
  const role = options.role ?? 'OWNER';
  const principal = {
    ...ownerSession.principal,
    role,
    permissions: role === 'OWNER' ? ownerSession.principal.permissions : ['orders.view'],
    shopIds: [shopId, otherShopId],
    shopSummaries: [
      { id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false },
      { id: otherShopId, name: 'TUX Zamalek', active: true, temporaryClosed: false },
    ],
  };
  const firstOrder = detail({
    id: activeOrderId,
    status: 'ACTIVE',
    source: 'POS',
    displayOrderNo: 101,
    customerName: 'Ahmed Maadi',
    phone: '+201000000001',
    itemId: activeItemId,
  });
  const secondOrder: AdminOrderDetail = {
    ...detail({
      id: otherShopOrderId,
      status: 'DONE',
      source: 'ONLINE',
      displayOrderNo: 902,
      customerName: 'Mona Zamalek',
      phone: '+201000000002',
      itemId: doneItemId,
    }),
    shopId: otherShopId,
  };
  const searches: URL[] = [];
  const details: URL[] = [];
  const commands: unknown[] = [];

  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ principal, csrfToken }),
    }),
  );
  await page.route('**/api/admin/orders**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const requestedShopId = url.searchParams.get('shopId');
    expect(principal.shopIds).toContain(requestedShopId);
    if (request.method() !== 'GET') {
      commands.push(request.postDataJSON());
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'read_only_test_fixture' }),
      });
      return;
    }
    if (url.searchParams.get('view') === 'action-reasons') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reasons: [] }),
      });
      return;
    }
    const records =
      requestedShopId === shopId ? [firstOrder] : options.emptySecondShop ? [] : [secondOrder];
    const requestedOrderId = url.searchParams.get('orderId');
    if (requestedOrderId) {
      details.push(url);
      const selected = records.find((order) => order.id === requestedOrderId);
      await route.fulfill({
        status: selected ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(selected ?? { error: 'order_not_found_in_scope' }),
      });
      return;
    }
    searches.push(url);
    const term = (url.searchParams.get('q') ?? '').toLowerCase();
    const statuses = url.searchParams.getAll('status');
    const source = url.searchParams.get('source');
    const rows = records
      .filter((order) => statuses.length === 0 || statuses.includes(order.status))
      .filter((order) => !source || source === order.source)
      .filter(
        (order) =>
          !term ||
          [order.displayOrderLabel, order.customer?.name, order.customer?.normalizedPhone]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(term)),
      )
      .map(summary);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ shopId: requestedShopId, rows, nextCursor: null }),
    });
  });
  return { searches, details, commands };
}

test('TUX-006 Owner sees authorized shop, scoped data reload and no stale selected order on switch', async ({
  page,
}) => {
  const requests = await mockScopedOrderHistory(page);
  await page.goto(`/orders/${activeOrderId}`);
  await expect(page.getByLabel('Current order shop')).toContainText('TUX Maadi');
  await expect(page.getByLabel('Order detail').getByText('Ahmed Maadi')).toBeVisible();

  await page.locator('.shop-switcher select').selectOption(otherShopId);
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByLabel('Current order shop')).toContainText('TUX Zamalek');
  await expect(page.getByRole('button', { name: /#902/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /#101/ })).toHaveCount(0);
  await expect(page.getByLabel('Order detail').getByText('Select an order')).toBeVisible();
  await expect
    .poll(() => requests.searches.some((url) => url.searchParams.get('shopId') === otherShopId))
    .toBe(true);
  await page.getByRole('button', { name: /#902/ }).click();
  await expect(page.getByLabel('Order detail').getByText('Mona Zamalek')).toBeVisible();
  expect(
    requests.details.every((url) =>
      [shopId, otherShopId].includes(url.searchParams.get('shopId') ?? ''),
    ),
  ).toBe(true);
  expect(requests.commands).toHaveLength(0);
});

test('TUX-006 empty shop history differs from empty search and filters can be reset', async ({
  page,
}) => {
  const requests = await mockScopedOrderHistory(page, { emptySecondShop: true });
  await page.goto('/orders');
  await expect(page.getByRole('button', { name: /#101/ })).toBeVisible();
  await page.getByText('Search and filters', { exact: true }).click();
  await page.getByLabel('Search').fill('never-matches');
  await expect(page.getByText('No orders match these filters')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear order filters' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear order filters' }).click();
  await expect(page.getByRole('button', { name: /#101/ })).toBeVisible();

  await page.locator('.shop-switcher select').selectOption(otherShopId);
  await expect(page.getByLabel('Current order shop')).toContainText('TUX Zamalek');
  await expect(page.getByText('No orders in this shop yet')).toBeVisible();
  await expect(page.getByText(/New orders will appear here/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear order filters' })).toHaveCount(0);
  expect(requests.commands).toHaveLength(0);
});

test('TUX-006 restricted Manager cannot operate on another shop or a foreign direct detail link', async ({
  page,
}) => {
  const requests = await mockScopedOrderHistory(page, { role: 'MANAGER' });
  // A fresh direct detail navigation is scoped to the manager's initial shop A.
  await page.goto(`/orders/${otherShopOrderId}`);
  await expect(page.getByLabel('Current order shop')).toContainText('TUX Maadi');
  await expect(page.getByText('Order unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Order detail').getByText('Mona Zamalek')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to shop orders' }).click();

  await page.locator('.shop-switcher select').selectOption(otherShopId);
  await expect(page.getByRole('button', { name: /#902/ })).toBeVisible();
  await page.getByRole('button', { name: /#902/ }).click();
  await expect(page.getByLabel('Order detail').getByText('Mona Zamalek')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refund payment' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return items' })).toHaveCount(0);
  expect(
    requests.details.some(
      (url) =>
        url.searchParams.get('shopId') === shopId &&
        url.searchParams.get('orderId') === otherShopOrderId,
    ),
  ).toBe(true);
  expect(requests.commands).toHaveLength(0);
});

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`orders remain usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockOrders(page);
    await page.goto('/orders');

    const list = page.locator('.admin-master-detail__list');
    await list.getByRole('button', { name: /#101/ }).click();
    await expect(page.locator('.admin-master-detail__detail')).toBeVisible();
    if (viewport.width <= 1100) {
      await expect(list).toBeHidden();
      await expect(page.getByRole('link', { name: /back to orders/i })).toBeVisible();
    } else {
      await expect(list).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // Full-page screenshots of sticky shell/navigation must start at the real
    // page origin; clicking a lower list row can otherwise displace topbars.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await capturePremiumScreenshot(page, 'orders');
  });
}

if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    test('orders empty shop scope scene at ' + viewport.width + 'px', async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockOrders(page, { emptyOrders: true });
      await page.goto('/orders');
      await expect(page.getByText('No orders in this shop yet')).toBeVisible();
      await expect(page.getByRole('button', { name: /#101/ })).toHaveCount(0);
      await capturePremiumScreenshot(page, 'orders-empty');
    });
  }
}

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        test(`targeted P05 orders ${theme} ${entry} ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
          await mockOrders(page);
          await verifyTargetedVisualLayout(page, {
            route: '/orders',
            heading: 'Orders',
            theme,
            entry,
          });
          await captureTargetedAcceptance(page, 'p05', 'orders', theme, entry);
        });
      }
    }
  }
}

test('approved desktop order directory exposes named data columns without fake selection actions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await mockOrders(page);
  await page.goto('/orders');
  const header = page.locator('.admin-orders-list__columns');
  await expect(header).toBeVisible();
  for (const label of ['Order', 'Customer', 'Type', 'Source', 'Amount', 'Status', 'Date & time']) {
    await expect(header).toContainText(label);
  }
  const first = page.locator('.admin-order-row').first();
  await expect(first.locator('.admin-order-row__number')).toContainText('#101');
  await expect(first.locator('.admin-order-row__customer')).toContainText('Ahmed');
  await expect(first.locator('.admin-order-row__source')).toContainText('In-store');
  await expect(first.locator('.admin-order-row__status')).toContainText('Active');
  await expect(page.getByRole('button', { name: 'Bulk cancel' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('O2 KPIs remain shop-wide when only two directory rows are loaded', async ({ page }) => {
  const fixture = await mockOrders(page, { financeVisible: true });
  await page.goto('/orders');
  const strip = page.locator('dl[aria-label="Orders key metrics"]');
  await expect(strip).toContainText('65');
  await expect(strip).toContainText('7');
  await expect(strip).toContainText('EGP 4,715.50');
  await expect(strip).toContainText('EGP 79.18');
  expect(fixture.kpiRequests).toHaveLength(1);
  expect(fixture.kpiRequests[0]?.searchParams.get('cursor')).toBeNull();
});

test('O2 financial KPI fields never reveal money to orders-only viewer', async ({ page }) => {
  await mockOrders(page);
  await page.goto('/orders');
  const strip = page.locator('dl[aria-label="Orders key metrics"]');
  await expect(strip).toContainText('Requires finance access');
  await expect(strip).not.toContainText('EGP 4,715.50');
  await expect(strip).toContainText('65');
});

test('O2 zero paid orders have null AOV rather than fabricated zero', async ({ page }) => {
  await mockOrders(page, { emptyOrders: true, financeVisible: true });
  await page.goto('/orders');
  const strip = page.locator('dl[aria-label="Orders key metrics"]');
  await expect(strip).toContainText('No paid orders in selected period');
  await expect(strip).toContainText('Unavailable');
});

test('O1 nextCursor reveals additional server rows without changing the full-shop KPI', async ({
  page,
}) => {
  const fixture = await mockOrders(page, { paginate: true, financeVisible: true });
  await page.goto('/orders');
  const list = page.getByRole('region', { name: 'Orders' });
  await expect(list.getByRole('button', { name: /#101/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /#102/ })).toHaveCount(0);
  await expect(page.locator('dl[aria-label="Orders key metrics"]')).toContainText('65');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(list.getByRole('button', { name: /#102/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /#101/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await expect
    .poll(() => fixture.searches.some((url) => url.searchParams.get('cursor') === 'orders-next-2'))
    .toBe(true);
  await expect(page.locator('dl[aria-label="Orders key metrics"]')).toContainText('65');
  expect(fixture.kpiRequests).toHaveLength(1);
});

for (const width of [1100, 720] as const) {
  test(`Orders inspector landmarks remain reachable at ${width}px CSS viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockOrders(page);
    await page.goto('/orders');
    await page.getByRole('button', { name: /#101/ }).click();
    if (width === 1100) {
      await expect(page.locator('.admin-master-detail__list')).toBeHidden();
      await expect(page.getByRole('link', { name: /back to orders/i })).toBeVisible();
    }
    const inspector = page.getByRole('navigation', { name: 'Order detail sections' });
    await expect(inspector.getByRole('link')).toHaveCount(6);
    await inspector.getByRole('link', { name: 'History' }).click();
    await expect(page).toHaveURL(/#order-detail-history$/);
    await expect(page.locator('#order-detail-history')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'orders-inspector');
  });
}

test('approved Orders 1536×1024 reference composition remains fully navigable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await mockOrders(page, { financeVisible: true });
  await page.goto('/orders');
  const stripPosition = await page.locator('dl[aria-label="Orders key metrics"]').boundingBox();
  expect(stripPosition?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(300);
  await expect(page.getByLabel('Current order shop')).toContainText('TUX Maadi');
  await expect(page.getByRole('button', { name: 'Online requests' })).toBeVisible();
  const kpis = page.getByLabel('Orders key metrics');
  for (const exactLabel of [
    'Total Orders',
    'Total Revenue',
    'Average Order Value',
    'Active Orders',
  ]) {
    await expect(kpis.getByText(exactLabel, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: /#101/ }).click();
  await expect(page.getByRole('navigation', { name: 'Order detail sections' })).toBeVisible();
  await expect(page.locator('.admin-master-detail__list')).toBeVisible();
  const kpiBox = await page.locator('dl[aria-label="Orders key metrics"]').boundingBox();
  const inspectorBox = await page.locator('.admin-master-detail__detail').boundingBox();
  expect(kpiBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(kpiBox!.x + kpiBox!.width).toBeLessThanOrEqual(inspectorBox!.x);
  expect(Math.abs(kpiBox!.y - inspectorBox!.y)).toBeLessThanOrEqual(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await capturePremiumScreenshot(page, 'orders-reference');
  // The approved static reference is exactly one 1536 × 1024 viewport, not
  // a browser full-page image extending below the fold.
  if (process.env['TUX_ADMIN_EIGHT_TABS_CAPTURE'] === '1') {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: 'artifacts/p04-p07/orders-reference-1536x1024.png',
      fullPage: false,
      animations: 'disabled',
    });
  }
});

test('O1 date filters transmit Cairo-converted UTC instants to both Orders and full-shop KPIs', async ({
  page,
}) => {
  const fixture = await mockOrders(page, { financeVisible: true });
  await page.goto('/orders');
  await page.getByText('Search and filters', { exact: true }).click();
  const from = page.getByLabel('From date/time (Cairo)');
  const to = page.getByLabel('To date/time (Cairo)');
  await from.fill('2026-10-01T08:30');
  await to.fill('2026-10-01T10:30');
  await expect
    .poll(() =>
      fixture.searches.some(
        (url) =>
          url.searchParams.get('from') === '2026-10-01T05:30:00.000Z' &&
          url.searchParams.get('to') === '2026-10-01T07:30:00.000Z',
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      fixture.kpiRequests.some(
        (url) =>
          url.searchParams.get('from') === '2026-10-01T05:30:00.000Z' &&
          url.searchParams.get('to') === '2026-10-01T07:30:00.000Z',
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Clear date filters' }).click();
  await expect(from).toHaveValue('');
  await expect(to).toHaveValue('');
  // Returning to a cached, unfiltered query need not issue an unnecessary
  // second network request; validate the visible canonical result instead.
  await expect(page.getByRole('button', { name: /#101/ })).toBeVisible();
  await expect(page.locator('dl[aria-label="Orders key metrics"]')).toContainText('65');
});

test('O1 reversed Cairo range never submits an invalid list or money-aggregation query', async ({
  page,
}) => {
  const fixture = await mockOrders(page, { financeVisible: true });
  await page.goto('/orders');
  await expect(page.locator('dl[aria-label="Orders key metrics"]')).toContainText('65');
  await page.getByText('Search and filters', { exact: true }).click();
  await page.getByLabel('To date/time (Cairo)').fill('2026-10-01T08:30');
  await page.getByLabel('From date/time (Cairo)').fill('2026-10-02T10:30');
  await expect(page.getByRole('alert')).toContainText(
    'Start date/time must be before end date/time',
  );
  const oldSearches = fixture.searches.length;
  const oldKpis = fixture.kpiRequests.length;
  await page.waitForTimeout(100);
  expect(fixture.searches).toHaveLength(oldSearches);
  expect(fixture.kpiRequests).toHaveLength(oldKpis);
  await expect(page.getByRole('link', { name: /Export up to/ })).toHaveCount(0);
});

test('O4 immutable print action keeps its explanatory text readable without overlap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOrders(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /#101/ }).click();
  const print = page.locator('.admin-order-detail__print-action');
  await expect(print.getByRole('button', { name: 'Print order summary' })).toBeVisible();
  await expect(
    print.getByText('not a new numbered fiscal receipt', { exact: false }),
  ).toBeVisible();
  const layout = await print.evaluate((element) => {
    const style = getComputedStyle(element);
    const gap = Number.parseFloat(style.gap) || 0;
    const buttonRect = element.querySelector('button')?.getBoundingClientRect();
    const explanationRect = element.querySelector('small')?.getBoundingClientRect();
    return {
      display: style.display,
      gap,
      buttonRight: buttonRect?.right ?? 0,
      buttonBottom: buttonRect?.bottom ?? 0,
      explanationLeft: explanationRect?.left ?? 0,
      explanationTop: explanationRect?.top ?? 0,
    };
  });
  expect(['flex', 'grid']).toContain(layout.display);
  expect(layout.gap).toBeGreaterThanOrEqual(8);
  expect(
    layout.explanationTop >= layout.buttonBottom ||
      layout.explanationLeft - layout.buttonRight >= 8,
  ).toBe(true);
});

test('O3 inspector archives stay keyboard-discoverable and print includes their immutable facts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrders(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /#101/ }).click();
  const detail = page.getByLabel('Order detail');
  const identity = detail.getByText('Full order identity and references', { exact: true });
  const reconciliation = detail.getByText('Financial reconciliation breakdown', { exact: true });
  await expect(identity).toBeVisible();
  await expect(reconciliation).toBeVisible();

  await identity.click();
  await expect(detail.getByText('Unique order reference:', { exact: false })).toBeVisible();
  await reconciliation.click();
  await expect(detail.getByText('Allocated payments', { exact: true })).toBeVisible();

  // The user can print without manually opening archival disclosures.
  await identity.click();
  await reconciliation.click();
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(detail.getByText('Unique order reference:', { exact: false })).toBeVisible();
  await expect(detail.getByText('Allocated payments', { exact: true })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(detail.getByText('Unique order reference:', { exact: false })).toBeHidden();
  await expect(detail.getByText('Allocated payments', { exact: true })).toBeHidden();
});
