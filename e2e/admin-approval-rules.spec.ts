import { expect, test, type Page } from '@playwright/test';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
const ruleId = '3a7bd7ed-f722-4f91-bc32-4549a4897937';
const csrfToken = 'a'.repeat(64);

const existing = {
  id: ruleId,
  shopId,
  actionType: 'ORDER_RETURN',
  requesterPermission: 'orders.refund',
  approverPermission: 'approvals.review',
  requiresSecondPerson: true,
  requiresRequesterRepin: false,
  expiresAfterSeconds: 86400,
  thresholdContext: { minimumQuantityImpact: 1000 },
  active: true,
  editVersion: 4,
};

const availableActions = [
  {
    actionType: 'ORDER_RETURN',
    label: 'Order return',
    requesterPermission: 'orders.refund',
    thresholdKind: 'minimumQuantityImpact',
  },
  {
    actionType: 'ORDER_REFUND',
    label: 'Order refund',
    requesterPermission: 'orders.refund',
    thresholdKind: 'minimumMinor',
  },
  {
    actionType: 'EMPLOYEE_ROLE_CHANGE',
    label: 'Employee role change',
    requesterPermission: 'staff.manage',
    thresholdKind: null,
  },
];

async function mockRules(page: Page, role: 'OWNER' | 'MANAGER' = 'OWNER') {
  const writes: Record<string, unknown>[] = [];
  const rules = [{ ...existing }];
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        principal: {
          employeeId: '33333333-3333-4333-8333-333333333333',
          businessId: '44444444-4444-4444-8444-444444444444',
          role,
          permissions: ['settings.manage', 'approvals.review', 'catalog.view'],
          shopIds: [shopId],
          shopSummaries: [
            { id: shopId, name: 'TUX Downtown', active: true, temporaryClosed: false },
          ],
        },
        csrfToken,
      }),
    }),
  );
  await page.route('**/api/admin/approval-rules', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ rules, availableActions }),
      });
      return;
    }
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as Record<string, unknown>;
    writes.push(command);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, ruleId, editVersion: 5 }),
    });
  });
  return { writes };
}

test('edits approval rule with a typed threshold and captured revision', async ({ page }) => {
  const { writes } = await mockRules(page);
  await page.goto('/approvals/rules');
  await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit rule ORDER_RETURN' }).click();
  await page.getByLabel('Rule threshold value').fill('2500');
  await page.getByLabel('Rule expiry').fill('3600');
  await page.getByRole('button', { name: 'Save approval rule' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    type: 'rule.upsert',
    ruleId,
    shopId,
    actionType: 'ORDER_RETURN',
    requesterPermission: 'orders.refund',
    approverPermission: 'approvals.review',
    expiresAfterSeconds: 3600,
    threshold: { kind: 'minimumQuantityImpact', value: 2500 },
    expectedVersion: 4,
  });
});

test('shop managers cannot create business-wide approval policies', async ({ page }) => {
  await mockRules(page, 'MANAGER');
  await page.goto('/approvals/rules');
  await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Business-wide' })).toHaveCount(0);
  await expect(page.getByLabel('Rule scope')).toHaveValue(shopId);
});

test('does not expose an editable form for an unsupported legacy threshold', async ({ page }) => {
  await mockRules(page);
  await page.route('**/api/admin/approval-rules', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rules: [{ ...existing, thresholdContext: { unrecognizedThreshold: 1 } }],
        availableActions,
      }),
    }),
  );
  await page.goto('/approvals/rules');
  await expect(page.getByText('Unsupported legacy threshold — editing disabled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit rule ORDER_RETURN' })).toBeDisabled();
});

test('does not allow creating a policy for an unsupported action', async ({ page }) => {
  const { writes } = await mockRules(page);
  await page.goto('/approvals/rules');
  await expect(page.getByRole('option', { name: 'Order return' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'inventory.adjust' })).toHaveCount(0);
  await page.getByLabel('Rule action type').selectOption('ORDER_REFUND');
  await expect(page.getByText('Requester permission: orders.refund')).toBeVisible();
  await expect(page.getByRole('option', { name: 'Minimum quantity impact' })).toHaveCount(0);
  await page.getByLabel('Rule threshold type').selectOption('minimumMinor');
  await page.getByLabel('Rule threshold value').fill('1000');
  await page.getByRole('button', { name: 'Create approval rule' }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    actionType: 'ORDER_REFUND',
    requesterPermission: 'orders.refund',
    threshold: { kind: 'minimumMinor', value: 1000 },
  });
});

test('protects an unsupported legacy action from a misleading editable form', async ({ page }) => {
  await mockRules(page);
  await page.route('**/api/admin/approval-rules', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rules: [{ ...existing, actionType: 'inventory.adjust' }],
        availableActions,
      }),
    }),
  );
  await page.goto('/approvals/rules');
  await expect(page.getByText('Unsupported legacy action — editing disabled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit rule inventory.adjust' })).toBeDisabled();
});

test('shows a readable policy model with preview', async ({ page }) => {
  await mockRules(page);
  await page.goto('/approvals/rules');
  await expect(page.getByText('When', { exact: true })).toBeVisible();
  await expect(page.getByText('Rule preview')).toBeVisible();
  await expect(page.getByText(/authorized reviewer/i).first()).toBeVisible();
});

test('explains the next safe step for legacy rules', async ({ page }) => {
  await mockRules(page);
  await page.route('**/api/admin/approval-rules', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rules: [{ ...existing, thresholdContext: { legacyThreshold: 1 } }],
        availableActions,
      }),
    }),
  );
  await page.goto('/approvals/rules');
  await expect(page.getByText(/Legacy.*cannot edit/i)).toBeVisible();
  await expect(page.getByText(/authorized administrator.*supported rule/i)).toBeVisible();
});

for (const width of [320, 375, 390, 768, 1280, 1440]) {
  test(`P03 screenshot rule builder and legacy rule mocked Chromium at ${width}`, async ({
    page,
  }) => {
    test.skip(process.env['P03_CAPTURE'] !== '1', 'Visual evidence runs in the exact-head job');
    await page.setViewportSize({ width, height: width < 500 ? 844 : 960 });
    await mockRules(page);
    await page.goto('/approvals/rules');
    await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible();
    await page.screenshot({ path: `artifacts/p03/approval-rules-${width}.png`, fullPage: true });
    await page.route('**/api/admin/approval-rules', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rules: [
            { ...existing, thresholdContext: { unsupportedLegacyThreshold: 1 }, active: false },
          ],
          availableActions,
        }),
      }),
    );
    await page.reload();
    await expect(page.getByText(/Legacy \/ cannot edit/)).toBeVisible();
    await page.screenshot({
      path: `artifacts/p03/approval-rules-legacy-${width}.png`,
      fullPage: true,
    });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('P03 screenshot manager policy scope and dark appearance mocked Chromium', async ({
  page,
}) => {
  test.skip(process.env['P03_CAPTURE'] !== '1', 'Visual evidence runs in the exact-head job');
  await page.setViewportSize({ width: 390, height: 844 });
  await mockRules(page, 'MANAGER');
  await page.goto('/approvals/rules');
  await expect(page.getByRole('option', { name: 'Business-wide' })).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/p03/approval-rules-manager-390.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.screenshot({ path: 'artifacts/p03/approval-rules-dark-1440.png', fullPage: true });
});

test('rule safety switches remain compact and keyboard accessible on a phone', async ({ page }) => {
  await mockRules(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/approvals/rules');
  for (const name of ['Require different approver', 'Require requester re-PIN', 'Rule enabled']) {
    const checkbox = page.getByRole('checkbox', { name });
    await expect(checkbox).toBeVisible();
    const bounds = await checkbox.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThanOrEqual(24);
    expect(bounds!.height).toBeLessThanOrEqual(24);
  }
});

// Visual ownership contract: a lazy-loaded rule editor must look identical whether
// entered directly or after visiting another feature in the same SPA document.
for (const width of [320, 390, 1440]) {
  test(`P03 screenshot CSS ownership direct vs warm approval rules at ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const geometryBaselines = new Map<string, unknown>();
    const screenshotBaselines = new Map<string, Buffer>();
    for (const legacy of [false, true]) {
      for (const entry of ['direct', 'approvals', 'catalog'] as const) {
        const context = await browser.newContext({
          viewport: { width, height: width < 500 ? 844 : 960 },
        });
        const page = await context.newPage();
        try {
          await mockRules(page);
          if (legacy) {
            await page.route('**/api/admin/approval-rules', (route) =>
              route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                  rules: [
                    {
                      ...existing,
                      thresholdContext: { unsupportedLegacyThreshold: 1 },
                      active: false,
                    },
                  ],
                  availableActions,
                }),
              }),
            );
          }
          if (entry === 'direct') {
            await page.goto('/approvals/rules');
          } else {
            await page.goto(entry === 'approvals' ? '/approvals' : '/catalog/products');
            await expect(page.locator('.admin-page').first()).toBeVisible();
            // Exercise the client-side router without a document refresh.
            await page.evaluate(() => {
              history.pushState({}, '', '/approvals/rules');
              dispatchEvent(new PopStateEvent('popstate'));
            });
          }
          await expect(page.getByRole('heading', { name: 'Approval rules' })).toBeVisible();
          await expect(page.locator('.admin-approval-rule-preview')).toBeVisible();
          if (legacy) await expect(page.getByText(/Legacy \/ cannot edit/)).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          const read = async () =>
            page.evaluate(() => {
              const surface = (selector: string) => {
                const element = document.querySelector<HTMLElement>(selector);
                if (!element) throw new Error('Missing ' + selector);
                const style = getComputedStyle(element);
                const box = element.getBoundingClientRect();
                return {
                  display: style.display,
                  padding: style.paddingTop + ' ' + style.paddingLeft,
                  background: style.backgroundColor,
                  border:
                    style.borderTopWidth + ' ' + style.borderTopStyle + ' ' + style.borderTopColor,
                  radius: style.borderTopLeftRadius,
                  gap: style.columnGap,
                  geometry: [Math.round(box.x), Math.round(box.width), Math.round(box.height)],
                };
              };
              const checkbox = document.querySelector<HTMLInputElement>(
                '.admin-approval-rule-builder__toggle input[type="checkbox"]',
              )!;
              const text = checkbox.parentElement!.querySelector('span')!;
              const box = checkbox.getBoundingClientRect();
              const textBox = text.getBoundingClientRect();
              return {
                preview: surface('.admin-approval-rule-preview'),
                authority: surface('.admin-approval-rule-builder__authority'),
                toggle: surface('.admin-approval-rule-builder__toggle'),
                checkbox: {
                  width: Math.round(box.width),
                  height: Math.round(box.height),
                  adjacent: box.right <= textBox.left,
                  verticalAlignment: Math.round(
                    Math.abs(box.top + box.height / 2 - (textBox.top + textBox.height / 2)),
                  ),
                },
                overflow: Math.round(document.documentElement.scrollWidth - innerWidth),
              };
            });
          const style = await read();
          expect(style.preview.padding).toBe('16px 16px');
          expect(style.authority.padding).toBe('16px 16px');
          expect(style.preview.border).toMatch(/^1px solid /);
          expect(style.authority.border).toMatch(/^1px solid /);
          expect(style.preview.background).not.toBe('rgba(0, 0, 0, 0)');
          expect(style.authority.background).not.toBe('rgba(0, 0, 0, 0)');
          expect(style.toggle.display).toBe('flex');
          expect(style.checkbox.width).toBeLessThanOrEqual(24);
          expect(style.checkbox.height).toBeLessThanOrEqual(24);
          expect(style.checkbox.adjacent).toBe(true);
          expect(style.checkbox.verticalAlignment).toBeLessThanOrEqual(12);
          expect(style.overflow).toBeLessThanOrEqual(1);

          const key = legacy ? 'legacy' : 'normal';
          const screen = await page.locator('.admin-approval-rule-builder').screenshot({
            path: `artifacts/p03/rules-css-${key}-${width}-${entry}.png`,
            animations: 'disabled',
          });
          if (entry === 'direct') {
            geometryBaselines.set(key, style);
            screenshotBaselines.set(key, screen);
          } else {
            expect(style, `computed CSS/geometry differs for ${entry} ${key} ${width}px`).toEqual(
              geometryBaselines.get(key),
            );
            expect(
              screen.equals(screenshotBaselines.get(key)!),
              `screenshot differs for ${entry} ${key} ${width}px`,
            ).toBe(true);
          }

          // A real reload also must hydrate with the feature stylesheet.
          await page.reload();
          await expect(page.locator('.admin-approval-rule-preview')).toBeVisible();
          await expect(await read()).toEqual(style);
          await page.getByLabel('Rule action type').selectOption('ORDER_RETURN');
          const action = page.getByRole('button', { name: 'Create approval rule' });
          await action.scrollIntoViewIfNeeded();
          await action.click({ trial: true }); // verifies no bottom-nav occlusion; no write
          const checkbox = page.getByRole('checkbox', { name: 'Require different approver' });
          await checkbox.focus();
          await checkbox.press('Space');
          await expect(checkbox).not.toBeChecked();
          await checkbox.press('Space');
          await expect(checkbox).toBeChecked();
        } finally {
          await context.close();
        }
      }
    }
  });
}
