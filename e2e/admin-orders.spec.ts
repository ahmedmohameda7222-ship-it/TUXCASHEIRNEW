import type { AdminOrderDetail, AdminOrderSummary } from '@tux/admin-contracts';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type OrderId,
  type OrderSnapshot,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import {
  OrderLifecycleConvergenceService,
  type OrderLifecycleFeedPage,
  type OrderLifecycleFeedTransport,
} from '@tux/sync';
import { expect, test, type Page, type Route } from '@playwright/test';

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
    payments: [
      {
        id: paymentId,
        methodLabel: 'Cash',
        logicType: 'CASH',
        allocatedMinor: 12500,
        receivedMinor: 12500,
        changeMinor: 0,
      },
    ],
    items: [
      {
        id: input.itemId,
        productId: 'dededede-dede-4ede-8ede-dededededede',
        productName: 'TUX Burger',
        quantity: 1,
        unitPriceMinor: 12500,
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

async function mockOrders(page: Page, options: { staleCancellation?: boolean } = {}) {
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
  const commands: Record<string, unknown>[] = [];
  const searches: URL[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
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
      const rows = [active, done]
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
        body: JSON.stringify({ shopId, rows, nextCursor: null }),
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
  await expect(page.getByRole('button', { name: 'Cancel order' })).toBeVisible();

  await page.getByRole('button', { name: /#102/ }).click();
  await expect(page.getByRole('button', { name: 'Refund / return' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return items' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  await page.getByLabel('Search').fill('Mona');
  await page.getByLabel('Status').selectOption('DONE');
  await page.getByLabel('Source').selectOption('ONLINE');

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

test('ACTIVE cancellation uses a valid central reason and refreshes immutable reason history', async ({
  page,
}) => {
  const fixture = await mockOrders(page);
  await page.goto('/orders');

  await page.getByRole('button', { name: 'Cancel order' }).click();
  const reason = page.getByLabel('Cancellation reason');
  await expect(reason.locator('option')).toHaveCount(1);
  await expect(reason.locator(`option[value="${cancellationReasonId}"]`)).toHaveText(
    'Customer request',
  );
  await expect(reason.locator(`option[value="${refundReasonId}"]`)).toHaveCount(0);
  await expect(reason.locator(`option[value="${inactiveCancellationReasonId}"]`)).toHaveCount(0);

  await page.getByLabel('Note').fill('Customer called the shop');
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

  await expect(page.getByText(/CANCELLED · POS · revision 5/)).toBeVisible();
  await expect(page.getByText(/Customer request/)).toBeVisible();
});

test('stale operational revision conflict is surfaced without pretending cancellation succeeded', async ({
  page,
}) => {
  await mockOrders(page, { staleCancellation: true });
  await page.goto('/orders');

  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();

  await expect(page.getByRole('alert')).toContainText(/stale operational revision/i);
  await expect(page.getByText(/ACTIVE · POS · revision 4/)).toBeVisible();
});

test('DONE refund and return preserve reason snapshots and pending approval state in detail', async ({
  page,
}) => {
  const fixture = await mockOrders(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /#102/ }).click();

  await page.getByRole('button', { name: 'Refund / return' }).click();
  await page.getByLabel('Reason').selectOption(refundReasonId);
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByRole('button', { name: 'Submit refund' }).click();

  await expect.poll(() => fixture.done.financialEvents.length).toBe(1);
  await expect(page.getByText(/REFUND · PENDING APPROVAL/)).toBeVisible();
  await expect(page.getByText(/Customer requested refund · reason v3/)).toBeVisible();

  await page.getByRole('button', { name: 'Refund / return' }).click();
  await page.getByLabel('Reason').selectOption(returnReasonId);
  await page.getByLabel('Admin PIN').fill('1234');
  await page.getByLabel('Return quantity for TUX Burger').fill('1');
  await page.getByRole('button', { name: 'Return selected items' }).click();

  await expect.poll(() => fixture.done.financialEvents.length).toBe(2);
  await expect(page.getByText(/RETURN · POSTED/)).toBeVisible();
  await expect(page.getByText(/Quality issue · reason v5/)).toBeVisible();
});

function operationsOrder(): OrderSnapshot {
  return {
    id: parseEntityId<OrderId>(activeOrderId),
    shopId: parseEntityId<ShopId>(shopId),
    businessDayId: parseEntityId('13131313-1313-4131-8131-131313131313'),
    displayOrderNo: 101,
    idempotencyKey: 'order-101',
    status: 'ACTIVE',
    lifecycle: {
      revision: 0,
      doneAt: null,
      cancellation: null,
      returned: null,
    },
    source: 'POS',
    operatorWorkerId: parseEntityId('14141414-1414-4141-8141-141414141414'),
    operatorName: 'Ahmed',
    createdAt: instant('2026-09-23T06:00:00.000Z'),
    fulfillment: {
      orderTypeId: parseEntityId('15151515-1515-4151-8151-151515151515'),
      orderTypeLabel: 'Take away',
      behavior: 'TAKE_AWAY',
      delivery: null,
    },
    items: [
      {
        id: parseEntityId(activeItemId),
        productId: parseEntityId('16161616-1616-4161-8161-161616161616'),
        productName: 'TUX Burger',
        unitPriceMinor: moneyMinor(12500),
        quantity: 1,
        modifiers: [],
        comboBeverages: [],
        itemNote: null,
      },
    ],
    orderNote: null,
    itemsSubtotalMinor: moneyMinor(12500),
    discountMinor: moneyMinor(0),
    deliveryFeeMinor: moneyMinor(0),
    totalMinor: moneyMinor(12500),
    payments: [
      {
        id: parseEntityId(paymentId),
        method: {
          id: parseEntityId('17171717-1717-4171-8171-171717171717'),
          label: 'Cash',
          logicType: 'CASH',
        },
        allocatedMinor: moneyMinor(12500),
        receivedMinor: moneyMinor(12500),
        changeMinor: moneyMinor(0),
      },
    ],
  };
}

function fakeOperationsDatabase() {
  let stored = operationsOrder();
  let cursor: string | null = null;
  const transaction = {
    orders: {
      async getById(id: OrderId) {
        return id === stored.id ? stored : null;
      },
      async updateOperationalState(next: OrderSnapshot) {
        stored = next;
      },
      async getLifecycleSyncCursor(_shopId: ShopId) {
        return cursor;
      },
      async setLifecycleSyncCursor(_shopId: ShopId, next: string) {
        cursor = next;
      },
    },
  } as unknown as OperationsTransaction;
  const database: OperationsDatabase = {
    transaction: async (work) => work(transaction),
  };
  return {
    database,
    get order() {
      return stored;
    },
    get cursor() {
      return cursor;
    },
  };
}

test('idle Operations convergence pulls Admin cancellation proactively and ignores stale lifecycle overwrite', async () => {
  const state = fakeOperationsDatabase();
  let page: OrderLifecycleFeedPage = {
    shopId: parseEntityId<ShopId>(shopId),
    events: [
      {
        sequence: 44,
        orderId: parseEntityId<OrderId>(activeOrderId),
        operationalRevision: 5,
        status: 'CANCELLED',
        eventType: 'CANCELLED',
        occurredAt: instant('2026-09-23T06:05:00.000Z'),
        workerId: null,
        workerName: 'Admin',
        adminEmployeeId: ownerSession.principal.employeeId,
        foodPrepared: false,
        stockRestored: true,
        reason: {
          id: cancellationReasonId,
          key: 'CUSTOMER_REQUEST',
          label: 'Customer request',
          family: 'CANCELLATION',
          version: 4,
          scope: 'BUSINESS',
        },
        note: 'Customer called the shop',
      },
    ],
    nextCursor: '44',
    hasMore: false,
  };
  let pulls = 0;
  const transport: OrderLifecycleFeedTransport = {
    async pull(requestShopId, cursor) {
      pulls += 1;
      expect(requestShopId).toBe(parseEntityId<ShopId>(shopId));
      expect(cursor).toBe(pulls === 1 ? null : '44');
      return page;
    },
  };
  const service = new OrderLifecycleConvergenceService(state.database, transport);

  expect(await service.syncShop(parseEntityId<ShopId>(shopId))).toBe(1);
  expect(pulls).toBe(1);
  expect(state.order.status).toBe('CANCELLED');
  expect(state.order.lifecycle?.revision).toBe(5);
  expect(state.cursor).toBe('44');

  page = {
    shopId: parseEntityId<ShopId>(shopId),
    events: [
      {
        sequence: 45,
        orderId: parseEntityId<OrderId>(activeOrderId),
        operationalRevision: 4,
        status: 'DONE',
        eventType: 'MARKED_DONE',
        occurredAt: instant('2026-09-23T06:04:00.000Z'),
        workerId: parseEntityId('14141414-1414-4141-8141-141414141414'),
        workerName: 'Ahmed',
        adminEmployeeId: null,
        foodPrepared: null,
        stockRestored: null,
        reason: null,
        note: null,
      },
    ],
    nextCursor: '45',
    hasMore: false,
  };

  expect(await service.syncShop(parseEntityId<ShopId>(shopId))).toBe(0);
  expect(state.order.status).toBe('CANCELLED');
  expect(state.order.lifecycle?.revision).toBe(5);
  expect(state.cursor).toBe('45');
});
