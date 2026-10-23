import { expect, test, type Page, type Route } from '@playwright/test';

const BUSINESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE = '33333333-3333-4333-8333-333333333333';
const ORDER = '44444444-4444-4444-8444-444444444444';
const CONVERSATION = '55555555-5555-4555-8555-555555555555';
const DEVICE = '66666666-6666-4666-8666-666666666666';
const TEMPLATE = '77777777-7777-4777-8777-777777777777';

const session = {
  principal: {
    employeeId: EMPLOYEE,
    businessId: BUSINESS,
    role: 'OWNER',
    permissions: [
      'orders.view',
      'alerts.view',
      'devices.view',
      'devices.manage',
      'whatsapp.view',
      'whatsapp.manage',
    ],
    shopIds: [SHOP_A, SHOP_B],
    shopSummaries: [
      { id: SHOP_A, name: 'TUX Integration Shop A', active: true, temporaryClosed: false },
      { id: SHOP_B, name: 'TUX Integration Shop B', active: true, temporaryClosed: true },
    ],
  },
  csrfToken: 'i'.repeat(64),
};

const orderSummary = {
  id: ORDER,
  shopId: SHOP_A,
  status: 'ACTIVE',
  operationalRevision: 1,
  source: 'ONLINE',
  displayOrderNo: 8042,
  displayOrderLabel: '#8042',
  createdAt: '2026-10-22T12:00:00.000Z',
  totalMinor: 24500,
  customerName: 'Integration Customer',
  normalizedPhone: '+201000000042',
  orderTypeLabel: 'Delivery',
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installSyntheticCrossAppFixture(page: Page) {
  const requestedOrderShops: string[] = [];
  const requestedAlertShops: string[] = [];
  const requestedWhatsAppShops: string[] = [];

  await page.route('**/api/admin/session', (route) => json(route, session));
  await page.route('**/api/admin/orders**', (route) => {
    const url = new URL(route.request().url());
    const shopId = url.searchParams.get('shopId') ?? '';
    requestedOrderShops.push(shopId);
    if (url.searchParams.get('view') === 'action-reasons') return json(route, { reasons: [] });
    if (url.searchParams.get('orderId') === ORDER && shopId === SHOP_A) {
      return json(route, {
        ...orderSummary,
        customer: {
          contactId: '88888888-8888-4888-8888-888888888888',
          name: orderSummary.customerName,
          normalizedPhone: orderSummary.normalizedPhone,
        },
        fulfillment: {
          orderTypeLabel: 'Delivery',
          behavior: 'DELIVERY',
          address: 'Integration Street 42',
          deliveryZoneLabel: 'Maadi',
          finalDeliveryFeeMinor: 2500,
        },
        payments: [],
        items: [],
        statusHistory: [],
        financialEvents: [],
        inventoryMovements: [],
        auditEvents: [],
      });
    }
    return json(route, {
      shopId,
      rows: shopId === SHOP_A ? [orderSummary] : [],
      nextCursor: null,
    });
  });
  await page.route('**/api/admin/alerts?*', (route) => {
    const url = new URL(route.request().url());
    const shopId = url.searchParams.get('shopId') ?? '';
    requestedAlertShops.push(shopId);
    return json(route, {
      rows:
        shopId === SHOP_A
          ? [
              {
                id: 'alert_order_accepted_8042',
                businessId: BUSINESS,
                shopId: SHOP_A,
                shopName: 'TUX Integration Shop A',
                source: 'OPERATIONS',
                severity: 'INFO',
                title: 'Online order #8042 accepted',
                description: 'Canonical order is active in Operations.',
                observedAt: '2026-10-22T12:01:00.000Z',
                entityId: ORDER,
                href: `/orders/${ORDER}`,
                state: 'ACTIVE',
              },
            ]
          : [],
      nextCursor: null,
      asOf: '2026-10-22T12:05:00.000Z',
      scopeLabel: shopId === SHOP_A ? 'TUX Integration Shop A' : 'TUX Integration Shop B',
      unavailableSources: [],
    });
  });
  await page.route('**/api/admin/operations-health*', (route) => {
    const url = new URL(route.request().url());
    const shopId = url.searchParams.get('shopId') ?? '';
    const view = url.searchParams.get('view');
    if (view === 'devices') {
      return json(route, {
        view,
        asOf: '2026-10-22T12:05:00.000Z',
        devices:
          shopId === SHOP_A
            ? [
                {
                  id: DEVICE,
                  shopId: SHOP_A,
                  label: 'Integration counter',
                  revoked: false,
                  lastSeenAt: '2026-10-22T12:04:00.000Z',
                  observedAt: '2026-10-22T12:04:00.000Z',
                  sessionState: 'ACTIVE',
                  configVersion: '9',
                  capabilities: {
                    canRename: false,
                    canRevoke: false,
                    canMoveShop: false,
                    canEnroll: false,
                    canRefreshConfig: false,
                    canTestPrint: false,
                  },
                },
              ]
            : [],
      });
    }
    if (view === 'device') {
      return json(route, {
        view,
        asOf: '2026-10-22T12:05:00.000Z',
        device:
          shopId === SHOP_A
            ? {
                id: DEVICE,
                shopId: SHOP_A,
                label: 'Integration counter',
                revoked: false,
                lastSeenAt: '2026-10-22T12:04:00.000Z',
                observedAt: '2026-10-22T12:04:00.000Z',
                sessionState: 'ACTIVE',
                configVersion: '9',
                capabilities: {
                  canRename: false,
                  canRevoke: false,
                  canMoveShop: false,
                  canEnroll: false,
                  canRefreshConfig: false,
                  canTestPrint: false,
                },
              }
            : null,
      });
    }
    return json(route, {
      view: 'summary',
      health: {
        shopId,
        shopName: shopId === SHOP_A ? 'TUX Integration Shop A' : 'TUX Integration Shop B',
        asOf: '2026-10-22T12:05:00.000Z',
        overall: shopId === SHOP_A ? 'STALE' : 'UNKNOWN',
        components: [
          {
            key: 'DEVICES',
            state: shopId === SHOP_A ? 'HEALTHY' : 'UNKNOWN',
            observedAt: shopId === SHOP_A ? '2026-10-22T12:04:00.000Z' : null,
            reason:
              shopId === SHOP_A
                ? 'A device heartbeat was observed within five minutes.'
                : 'No device heartbeat has been observed for this shop.',
            href: '/devices/list',
          },
          {
            key: 'SYNC',
            state: shopId === SHOP_A ? 'STALE' : 'UNKNOWN',
            observedAt: shopId === SHOP_A ? '2026-10-22T11:30:00.000Z' : null,
            reason:
              shopId === SHOP_A
                ? 'The latest canonical sync source is stale.'
                : 'No server-side sync heartbeat source is configured.',
            href: null,
          },
          {
            key: 'PRINTERS',
            state: 'NOT_CONFIGURED',
            observedAt: null,
            reason: 'Server-side printer telemetry is not configured.',
            href: null,
          },
        ],
      },
    });
  });
  await page.route('**/api/admin/whatsapp*', (route) => {
    const url = new URL(route.request().url());
    const shopId = url.searchParams.get('shopId') ?? '';
    const view = url.searchParams.get('view') ?? 'overview';
    requestedWhatsAppShops.push(shopId);
    const common = { view, shopId };
    const responses: Record<string, unknown> = {
      overview: {
        ...common,
        canManage: true,
        configured: shopId === SHOP_A,
        automationEnabled: shopId === SHOP_A,
        health: shopId === SHOP_A ? 'HEALTHY' : 'UNKNOWN',
        recentActivityAt: shopId === SHOP_A ? '2026-10-22T12:02:00.000Z' : null,
        totals: {
          conversations: shopId === SHOP_A ? 1 : 0,
          failed: 0,
          uncertain: 0,
          approvedTemplates: shopId === SHOP_A ? 1 : 0,
        },
      },
      conversations: {
        ...common,
        rows:
          shopId === SHOP_A
            ? [
                {
                  id: CONVERSATION,
                  displayName: 'Integration Customer',
                  maskedPhone: '+20••••••0042',
                  unreadCount: 0,
                  lastMessageAt: '2026-10-22T12:02:00.000Z',
                  linkedOrderId: ORDER,
                },
              ]
            : [],
        nextCursor: null,
      },
      conversation: {
        ...common,
        conversation: {
          id: CONVERSATION,
          displayName: 'Integration Customer',
          maskedPhone: '+20••••••0042',
          unreadCount: 0,
          lastMessageAt: '2026-10-22T12:02:00.000Z',
          linkedOrderId: ORDER,
        },
        customerId: '88888888-8888-4888-8888-888888888888',
        orderIds: [ORDER],
        messages: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            direction: 'OUTBOUND',
            kind: 'SYSTEM',
            text: 'Automatic order #8042 accepted update',
            status: 'SENT',
            author: 'TUX Automatic',
            senderKind: 'SYSTEM',
            failureCode: null,
            createdAt: '2026-10-22T12:02:00.000Z',
          },
        ],
      },
      templates: {
        ...common,
        rows:
          shopId === SHOP_A
            ? [
                {
                  id: TEMPLATE,
                  label: 'Order accepted',
                  providerTemplateId: 'order_accepted',
                  languageCode: 'ar_EG',
                  state: 'APPROVED',
                },
              ]
            : [],
      },
      'quick-replies': { ...common, canManage: true, rows: [] },
      'automatic-messages': {
        ...common,
        canManage: true,
        automationEnabled: shopId === SHOP_A,
        rows: [
          {
            id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            eventType: 'ORDER_ACCEPTED',
            templateId: TEMPLATE,
            languageCode: 'ar_EG',
            templateState: 'APPROVED',
            enabled: shopId === SHOP_A,
            supported: true,
            unsupportedReason: null,
            version: 1,
          },
          {
            id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
            eventType: 'DELIVERY_DELIVERED',
            templateId: TEMPLATE,
            languageCode: 'ar_EG',
            templateState: 'APPROVED',
            enabled: false,
            supported: false,
            unsupportedReason: 'No canonical delivery event source is available.',
            version: 1,
          },
        ],
      },
      analytics: {
        ...common,
        available: false,
        sent: null,
        delivered: null,
        read: null,
        failed: null,
        uncertain: null,
        responseTimeMinutes: null,
      },
      channels: { ...common, canManage: true, configured: shopId === SHOP_A, rows: [] },
      health: {
        ...common,
        configured: shopId === SHOP_A,
        state: shopId === SHOP_A ? 'HEALTHY' : 'UNKNOWN',
        lastWebhookAt: null,
        lastOutboundAt: shopId === SHOP_A ? '2026-10-22T12:02:00.000Z' : null,
        lastErrorCode: null,
      },
    };
    return json(route, responses[view]);
  });

  return { requestedOrderShops, requestedAlertShops, requestedWhatsAppShops };
}

test('keeps the canonical Menu order consistent through Operations and scoped Admin views', async ({
  page,
}) => {
  const requests = await installSyntheticCrossAppFixture(page);

  await page.goto('/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByText('#8042', { exact: true })).toBeVisible();
  await expect(page.getByText('Integration Customer')).toBeVisible();

  await page.goto('/alerts');
  await expect(page.getByText('Online order #8042 accepted')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Operations' })).toHaveAttribute(
    'href',
    '/devices',
  );

  await page.goto('/whatsapp/conversations/' + CONVERSATION);
  await expect(page.getByText('Automatic order #8042 accepted update')).toBeVisible();
  await expect(page.getByText('TUX Automatic')).toBeVisible();
  await expect(page.getByRole('button', { name: /send/i })).toHaveCount(0);

  await page.goto('/whatsapp/automatic-messages');
  await expect(page.getByText('No canonical delivery event source is available.')).toBeVisible();

  await page.goto('/devices');
  await expect(page.getByText('The latest canonical sync source is stale.')).toBeVisible();
  await expect(page.getByText('Server-side printer telemetry is not configured.')).toBeVisible();

  const shopSwitcher = page.locator('.shop-switcher select');
  await shopSwitcher.selectOption(SHOP_B);
  await expect(
    page.getByText('No device heartbeat has been observed for this shop.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByText('#8042', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No orders/i)).toBeVisible();

  expect(requests.requestedOrderShops).toContain(SHOP_A);
  expect(requests.requestedOrderShops).toContain(SHOP_B);
  expect(requests.requestedAlertShops.every((shopId) => shopId === SHOP_A)).toBe(true);
  expect(requests.requestedWhatsAppShops.every((shopId) => shopId === SHOP_A)).toBe(true);
});

test('keeps device controls honest and unavailable without a safe transport', async ({ page }) => {
  await installSyntheticCrossAppFixture(page);
  await page.goto('/devices/list');
  await page.getByRole('link', { name: 'Integration counter' }).click();
  await expect(page.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test print' })).toBeDisabled();
});

