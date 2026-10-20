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
          permissions: ['settings.manage'],
          shopIds: [shopId],
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
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      rules: [{ ...existing, thresholdContext: { legacyThreshold: 1 } }], availableActions,
    }) }),
  );
  await page.goto('/approvals/rules');
  await expect(page.getByText(/Legacy.*cannot edit/i)).toBeVisible();
  await expect(page.getByText(/authorized administrator.*supported rule/i)).toBeVisible();
});
