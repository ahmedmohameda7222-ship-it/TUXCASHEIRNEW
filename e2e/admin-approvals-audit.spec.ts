import { expect, test, type Page } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

const shopId = '11111111-1111-4111-8111-111111111111';
const approvalId = '22222222-2222-4222-8222-222222222222';
const secondApprovalId = '66666666-6666-4666-8666-666666666666';
let approvalDecided = false;

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['approvals.review', 'audit.view'],
    shopIds: [shopId],
  },
  csrfToken: 'a'.repeat(64),
};

async function mockAdmin(page: Page) {
  approvalDecided = false;
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });
  await page.route('**/api/admin/approvals*', async (route) => {
    if (route.request().method() === 'POST') {
      approvalDecided = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, requestId: approvalId, status: 'APPROVED' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        approvals: [
          {
            id: approvalId,
            requesterName: 'Owner One',
            requesterEmployeeId: 'owner-1',
            approverName: approvalDecided ? 'Manager Two' : null,
            shopId,
            shopName: 'TUX',
            actionLabel: 'Emergency inventory adjustment',
            valueSummary: 'quantityImpact: -3',
            reason: 'Cycle count mismatch',
            consequence: 'The persisted command will execute after approval.',
            status: approvalDecided ? 'EXECUTING' : 'PENDING',
            displayStatus: approvalDecided ? 'EXECUTING' : 'PENDING',
            canDecide: !approvalDecided,
            executionLabel: approvalDecided ? 'Execution in progress' : 'Not started',
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-09-16T16:30:00.000Z',
            decidedAt: approvalDecided ? '2026-09-16T16:40:00.000Z' : null,
          },
          {
            id: secondApprovalId,
            requesterName: 'Manager Two',
            requesterEmployeeId: 'manager-2',
            approverName: null,
            shopId,
            shopName: 'TUX',
            actionLabel: 'Supplier cost override',
            valueSummary: 'priceImpact: +2.50',
            reason: 'Updated supplier invoice',
            consequence: 'The new supplier cost will apply after approval.',
            status: 'PENDING',
            displayStatus: 'PENDING',
            canDecide: true,
            executionLabel: 'Not started',
            expiresAt: '2099-01-01T00:00:00.000Z',
            createdAt: '2026-09-16T16:20:00.000Z',
            decidedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/admin/audit*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        events: [
          {
            id: '55555555-5555-4555-8555-555555555555',
            shopId,
            shopName: 'TUX',
            actorEmployeeId: '33333333-3333-4333-8333-333333333333',
            actorLabel: 'Manager Two',
            actorRole: 'MANAGER',
            actionType: 'APPROVAL_APPROVED',
            entityType: 'APPROVAL_REQUEST',
            entityId: approvalId,
            beforeValue: { status: 'PENDING' },
            afterValue: { status: 'APPROVED' },
            reason: 'Reviewed on shift',
            approvalRequestId: approvalId,
            approvalStatus: 'APPROVED',
            createdAt: '2026-09-16T16:40:00.000Z',
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            shopId,
            shopName: 'TUX',
            actorEmployeeId: '33333333-3333-4333-8333-333333333333',
            actorLabel: 'Manager Two',
            actorRole: 'MANAGER',
            actionType: 'APPROVAL_REQUESTED',
            entityType: 'APPROVAL_REQUEST',
            entityId: secondApprovalId,
            beforeValue: null,
            afterValue: { status: 'PENDING' },
            reason: 'Supplier invoice updated',
            approvalRequestId: secondApprovalId,
            approvalStatus: 'PENDING',
            createdAt: '2026-09-16T16:20:00.000Z',
          },
        ],
      }),
    });
  });
}

for (const viewport of ADMIN_CORE_VIEWPORTS) {
  test(`renders approvals safely at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await mockAdmin(page);
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible();
    await expect(page.getByText('Emergency inventory adjustment').first()).toBeVisible();
    if (viewport.name === 'phone') {
      const list = page.locator('.admin-approval-list');
      const rows = list.locator('.admin-approval-list__item');
      await expect(rows).toHaveCount(2);
      const first = await rows.nth(0).boundingBox();
      const second = await rows.nth(1).boundingBox();
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
      expect(await list.evaluate((element) => getComputedStyle(element).overflowX)).toBe('visible');
    }
    await page.getByRole('button', { name: /Emergency inventory adjustment/ }).click();
    await expect(page.getByText('Cycle count mismatch')).toBeVisible();
  });
}

test('requires PIN confirmation and preserves recoverable execution state after reload', async ({
  page,
}) => {
  await mockAdmin(page);
  await page.goto('/approvals');
  await page.getByRole('button', { name: /Emergency inventory adjustment/ }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toContainText('Enter PIN to approve');
  await page.getByRole('textbox', { name: 'PIN' }).fill('482731');
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(page.getByText('Execution in progress')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Execution in progress')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('renders audit history as human-readable structured changes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdmin(page);
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  const list = page.locator('.admin-audit-list');
  const rows = list.locator('.admin-audit-list__item');
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  expect(await list.evaluate((element) => getComputedStyle(element).overflowX)).toBe('visible');
  const auditEvent = page.getByLabel('Audit events').getByRole('button').first();
  await expect(auditEvent).toContainText('Manager Two');
  await auditEvent.click();
  await expect(page.getByRole('heading', { name: 'Before' })).toBeVisible();
  const changes = page.locator('.admin-audit-change-grid');
  await expect(changes.getByText('Pending', { exact: true })).toBeVisible();
  await expect(changes.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText(approvalId).first()).toBeHidden();
});

test('exposes every required audit filter', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/audit');

  await expect(page.getByLabel('Action', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  for (const label of [
    'From date',
    'To date',
    'Shop',
    'Staff member',
    'Activity type',
    'Approval status',
  ]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
});
