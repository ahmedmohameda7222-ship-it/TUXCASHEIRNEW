import { expect, test, type Page } from '@playwright/test';

const SHOP = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const TEMPLATE = '33333333-3333-4333-8333-333333333333';
const RULE = '44444444-4444-4444-8444-444444444444';
const session = (manage = true) => ({
  principal: {
    employeeId: '55555555-5555-4555-8555-555555555555',
    businessId: '66666666-6666-4666-8666-666666666666',
    role: manage ? 'OWNER' : 'MANAGER',
    permissions: manage ? ['whatsapp.view', 'whatsapp.manage'] : ['whatsapp.view'],
    shopIds: [SHOP],
    shopSummaries: [{ id: SHOP, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken: 'a'.repeat(64),
});

async function mockWhatsApp(page: Page, manage = true) {
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session(manage)),
    }),
  );
  await page.route('**/api/admin/whatsapp*', async (route) => {
    if (route.request().method() === 'POST') {
      const csrf = route.request().headers()['x-tux-admin-csrf'];
      return route.fulfill({
        status: csrf === 'a'.repeat(64) && manage ? 200 : 403,
        contentType: 'application/json',
        body: JSON.stringify(
          csrf === 'a'.repeat(64) && manage
            ? { ok: true, code: 'updated', version: 2 }
            : { error: 'csrf_invalid' },
        ),
      });
    }
    const view = new URL(route.request().url()).searchParams.get('view');
    const responses: Record<string, unknown> = {
      overview: {
        view,
        shopId: SHOP,
        canManage: manage,
        configured: false,
        automationEnabled: false,
        health: 'UNKNOWN',
        recentActivityAt: null,
        totals: { conversations: 1, failed: 1, uncertain: 1, approvedTemplates: 0 },
      },
      conversations: {
        view,
        rows: [
          {
            id: CONVERSATION,
            displayName: 'Customer with a very long safe display name',
            maskedPhone: '+20••••••5678',
            unreadCount: 2,
            lastMessageAt: '2026-10-22T12:00:00Z',
            linkedOrderId: null,
          },
        ],
        nextCursor: null,
      },
      conversation: {
        view,
        conversation: {
          id: CONVERSATION,
          displayName: 'Customer',
          maskedPhone: '+20••••••5678',
          unreadCount: 2,
          lastMessageAt: '2026-10-22T12:00:00Z',
          linkedOrderId: null,
        },
        customerId: null,
        orderIds: [],
        messages: [
          {
            id: 'm1',
            direction: 'OUTBOUND',
            kind: 'TEXT',
            text: '<img src=x onerror=alert(1)>',
            status: 'SENT',
            author: 'Mona',
            senderKind: 'WORKER',
            failureCode: null,
            createdAt: '2026-10-22T11:59:00Z',
          },
          {
            id: 'm2',
            direction: 'OUTBOUND',
            kind: 'TEXT',
            text: 'Automatic update',
            status: 'UNCERTAIN',
            author: 'TUX Automatic',
            senderKind: 'SYSTEM',
            failureCode: 'provider_timeout',
            createdAt: '2026-10-22T12:00:00Z',
          },
        ],
      },
      templates: {
        view,
        rows: [
          {
            id: TEMPLATE,
            label: 'Order accepted',
            providerTemplateId: 'order_accepted',
            languageCode: 'ar_EG',
            state: 'PENDING',
          },
        ],
      },
      'quick-replies': { view, canManage: manage, rows: [] },
      'automatic-messages': {
        view,
        canManage: manage,
        automationEnabled: false,
        rows: [
          {
            id: RULE,
            eventType: 'ORDER_ACCEPTED',
            templateId: TEMPLATE,
            languageCode: 'ar_EG',
            templateState: 'PENDING',
            enabled: false,
            supported: true,
            unsupportedReason: null,
            version: 1,
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
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
        view,
        available: false,
        sent: null,
        delivered: null,
        read: null,
        failed: null,
        uncertain: null,
        responseTimeMinutes: null,
      },
      channels: { view, canManage: manage, configured: false, rows: [] },
      health: {
        view,
        configured: false,
        state: 'UNKNOWN',
        lastWebhookAt: null,
        lastOutboundAt: null,
        lastErrorCode: null,
      },
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(responses[view ?? 'overview']),
    });
  });
}

const widths = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 375, height: 844 },
  { width: 320, height: 720 },
] as const;
for (const viewport of widths)
  test(`renders WhatsApp control center at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockWhatsApp(page);
    await page.goto('/whatsapp');
    await expect(page.getByRole('heading', { name: 'WhatsApp', exact: true })).toBeVisible();
    await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
    await expect(page.getByText('Unknown', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/final/p10/whatsapp-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });

test('keeps conversations read-only, escapes HTML and preserves attribution', async ({ page }) => {
  await mockWhatsApp(page);
  await page.goto(`/whatsapp/conversations/${CONVERSATION}`);
  await expect(page.getByText('Mona')).toBeVisible();
  await expect(page.getByText('TUX Automatic')).toBeVisible();
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /send/i })).toHaveCount(0);
});

test('disables pending and unsupported automation and hides edits from view-only roles', async ({
  page,
}) => {
  await mockWhatsApp(page);
  await page.goto('/whatsapp/automatic-messages');
  await expect(page.getByRole('button', { name: 'Turn on' }).first()).toBeDisabled();
  await expect(page.getByText('No canonical delivery event source is available.')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await mockWhatsApp(page, false);
  await page.goto('/whatsapp/quick-replies');
  await expect(page.getByRole('button', { name: 'Save quick reply' })).toHaveCount(0);
});

test('supports keyboard navigation, dark theme and cold routes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWhatsApp(page);
  await page.goto('/whatsapp');
  await page.getByRole('link', { name: 'Health' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'WhatsApp Health' })).toBeVisible();
  await page.goto('/orders');
  await page.goto('/whatsapp');
  await expect(page.locator('.admin-whatsapp-grid')).toBeVisible();
  await page.screenshot({ path: 'artifacts/final/p10/whatsapp-dark-390x844.png', fullPage: true });
});
