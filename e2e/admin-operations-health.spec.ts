import { expect, test, type Page } from '@playwright/test';

const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEMPLATE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DAY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['devices.view', 'devices.manage', 'alerts.view'],
    shopIds: [SHOP_A, SHOP_B],
    shopSummaries: [
      { id: SHOP_A, name: 'TUX Maadi', active: true, temporaryClosed: false },
      { id: SHOP_B, name: 'TUX Zamalek', active: true, temporaryClosed: false },
    ],
  },
  csrfToken: 'a'.repeat(64),
};

async function mockAdmin(page: Page, canManage = true) {
  const session = canManage
    ? ownerSession
    : {
        ...ownerSession,
        principal: {
          ...ownerSession.principal,
          role: 'MANAGER',
          permissions: ['devices.view'],
          shopIds: [SHOP_A],
          shopSummaries: [ownerSession.principal.shopSummaries[0]],
        },
      };
  const notes = [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      shopId: SHOP_A,
      note: 'Morning handoff complete.',
      authorEmployeeId: session.principal.employeeId,
      createdAt: '2026-10-22T09:00:00.000Z',
      correctionOfId: null,
    },
  ];
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) }),
  );
  await page.route('**/api/admin/operations-health*', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { type: string; note?: string };
      if (body.type === 'daily.manager-note.append' && body.note)
        notes.unshift({
          id: crypto.randomUUID(),
          shopId: SHOP_A,
          note: body.note,
          authorEmployeeId: session.principal.employeeId,
          createdAt: '2026-10-22T10:00:00.000Z',
          correctionOfId: null,
        });
      return route.fulfill({
        status: canManage ? 200 : 403,
        contentType: 'application/json',
        body: JSON.stringify(canManage ? { ok: true } : { error: 'permission_forbidden' }),
      });
    }
    const view = new URL(request.url()).searchParams.get('view');
    const body =
      view === 'summary'
        ? {
            view,
            health: {
              shopId: SHOP_A,
              shopName: 'TUX Maadi',
              asOf: '2026-10-22T09:05:00.000Z',
              overall: 'UNKNOWN',
              components: [
                {
                  key: 'DEVICES',
                  state: 'HEALTHY',
                  observedAt: '2026-10-22T09:04:00.000Z',
                  reason: 'A device heartbeat was observed within five minutes.',
                  href: '/devices',
                },
                {
                  key: 'SYNC',
                  state: 'UNKNOWN',
                  observedAt: null,
                  reason: 'No server-side sync heartbeat source is configured.',
                  href: null,
                },
                {
                  key: 'BUSINESS_DAY',
                  state: 'HEALTHY',
                  observedAt: '2026-10-22T07:00:00.000Z',
                  reason: 'Business day is open.',
                  href: '/finance/end-day',
                },
                {
                  key: 'ONLINE_ORDERS',
                  state: 'HEALTHY',
                  observedAt: '2026-10-22T09:05:00.000Z',
                  reason: 'Online ordering is enabled in canonical shop settings.',
                  href: '/settings',
                },
                {
                  key: 'PRINTERS',
                  state: 'NOT_CONFIGURED',
                  observedAt: null,
                  reason: 'Server-side printer telemetry is not configured.',
                  href: null,
                },
                {
                  key: 'WHATSAPP',
                  state: 'NOT_CONFIGURED',
                  observedAt: null,
                  reason: 'WhatsApp is not configured for this shop.',
                  href: '/whatsapp',
                },
              ],
            },
          }
        : view === 'devices'
          ? {
              view,
              asOf: '2026-10-22T09:05:00.000Z',
              devices: [
                {
                  id: DEVICE,
                  shopId: SHOP_A,
                  label: 'Front counter device with a deliberately long label for wrapping',
                  revoked: false,
                  lastSeenAt: '2026-10-22T09:04:00.000Z',
                  observedAt: '2026-10-22T09:04:00.000Z',
                  sessionState: 'ACTIVE',
                  configVersion: '7',
                  capabilities: {
                    canRename: false,
                    canRevoke: false,
                    canMoveShop: false,
                    canEnroll: false,
                    canRefreshConfig: false,
                    canTestPrint: false,
                  },
                },
              ],
            }
          : view === 'device'
            ? {
                view,
                asOf: '2026-10-22T09:05:00.000Z',
                device: {
                  id: DEVICE,
                  shopId: SHOP_A,
                  label: 'Front counter device',
                  revoked: false,
                  lastSeenAt: '2026-10-22T09:04:00.000Z',
                  observedAt: '2026-10-22T09:04:00.000Z',
                  sessionState: 'ACTIVE',
                  configVersion: '7',
                  capabilities: {
                    canRename: false,
                    canRevoke: false,
                    canMoveShop: false,
                    canEnroll: false,
                    canRefreshConfig: false,
                    canTestPrint: false,
                  },
                },
              }
            : view === 'daily-checklist'
              ? {
                  view,
                  checklist: {
                    shopId: SHOP_A,
                    businessDayId: DAY,
                    kind: 'OPEN',
                    configured: true,
                    templateId: TEMPLATE,
                    templateTitle: 'Opening readiness',
                    templateVersion: 1,
                    runId: null,
                    runVersion: null,
                    openedAt: null,
                    completedAt: null,
                    actorEmployeeId: null,
                    items: [
                      {
                        id: ITEM,
                        label: 'Verify the front counter and cash drawer are ready',
                        required: true,
                        done: false,
                        doneByEmployeeId: null,
                        doneAt: null,
                      },
                    ],
                  },
                }
              : { view: 'manager-log', page: { rows: notes, nextCursor: null } };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
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
for (const viewport of widths) {
  test(`renders honest operations health without overflow at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockAdmin(page);
    await page.goto('/devices');
    await expect(page.getByRole('heading', { name: 'Operations health' })).toBeVisible();
    await expect(page.getByText('Unknown', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Server-side printer telemetry is not configured.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `artifacts/final/p09/operations-health-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  });
}

test('keeps unsupported device and printer controls disabled', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/devices/list');
  await page.getByLabel('Search devices').fill('front counter');
  await page.getByRole('link', { name: /Front counter device/ }).click();
  await expect(page.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Test print' })).toBeDisabled();
  await page.goto('/devices/printers');
  await expect(page.getByText('Unavailable: no safe device print transport')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send test print' })).toBeDisabled();
});

test('supports keyboard checklist completion and preserves unsaved focus flow', async ({
  page,
}) => {
  page.on('pageerror', (error) => console.error('operations checklist page error', error));
  page.on('console', (message) => {
    if (message.type() === 'error')
      console.error('operations checklist console error', message.text());
  });
  await mockAdmin(page);
  await page.goto('/devices/opening-closing');
  const item = page.getByRole('checkbox', { name: /Verify the front counter/ });
  await item.focus();
  await page.keyboard.press('Space');
  await expect(item).toBeChecked();
  await page.locator('.shop-switcher select').selectOption(SHOP_B);
  const dialog = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.shop-switcher select')).toHaveValue(SHOP_A);
  await page.getByRole('button', { name: 'Complete checklist' }).click();
});

test('enforces read-only permissions and appends safe manager notes', async ({ page }) => {
  await mockAdmin(page, false);
  await page.goto('/devices/opening-closing');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Read-only access' })).toBeDisabled();
  await page.unrouteAll({ behavior: 'wait' });
  await mockAdmin(page, true);
  await page.goto('/devices/manager-log');
  await page.getByLabel('New note').fill('Evening handoff reviewed.');
  await page.getByRole('button', { name: 'Append note' }).click();
  await expect(page.getByText('Evening handoff reviewed.')).toBeVisible();
});

test('renders operations health in dark theme and owns cold-route styles', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdmin(page);
  await page.goto('/devices');
  const cold = await page
    .locator('.admin-health-card')
    .first()
    .evaluate(
      (element) => `${getComputedStyle(element).display}|${getComputedStyle(element).borderRadius}`,
    );
  await page.goto('/orders');
  await page.goto('/devices');
  const warm = await page
    .locator('.admin-health-card')
    .first()
    .evaluate(
      (element) => `${getComputedStyle(element).display}|${getComputedStyle(element).borderRadius}`,
    );
  expect(warm).toBe(cold);
  await page.screenshot({
    path: 'artifacts/final/p09/operations-health-dark-390x844.png',
    fullPage: true,
  });
});
