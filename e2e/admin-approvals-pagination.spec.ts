import { expect, test } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';

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

function approval(id: string, label: string, createdAt: string) {
  return {
    id,
    requesterName: 'Owner One',
    requesterEmployeeId: 'requester-1',
    approverName: null,
    shopId,
    shopName: 'TUX',
    actionLabel: label,
    valueSummary: 'quantityImpact: -1',
    reason: 'Cycle count mismatch',
    consequence: 'The persisted command will execute after approval.',
    status: 'PENDING',
    displayStatus: 'PENDING',
    canDecide: true,
    executionLabel: 'Not started',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt,
    decidedAt: null,
  };
}

function auditEvent(id: string, label: string, createdAt: string) {
  return {
    id,
    shopId,
    shopName: 'TUX',
    actorKind: 'HUMAN',
    actorEmployeeId: ownerSession.principal.employeeId,
    actorLabel: 'Owner One',
    actorRole: 'OWNER',
    actionType: label,
    entityType: 'INVENTORY_ITEM',
    entityId: 'item-1',
    beforeValue: { quantity: 2 },
    afterValue: { quantity: 1 },
    reason: 'Cycle count mismatch',
    approvalRequestId: null,
    requesterName: null,
    approverName: null,
    approvalStatus: null,
    createdAt,
  };
}

async function mockSession(page: import('@playwright/test').Page) {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });
}

test('loads approvals beyond the first bounded page using the continuation cursor', async ({
  page,
}) => {
  await mockSession(page);
  await page.route('**/api/admin/approvals*', async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get('cursor');
    const payload = cursor
      ? {
          approvals: [
            approval(
              '77777777-7777-4777-8777-777777777777',
              'Older inventory adjustment',
              '2026-09-17T10:00:00.000Z',
            ),
          ],
          nextCursor: null,
        }
      : {
          approvals: [
            approval(
              '66666666-6666-4666-8666-666666666666',
              'Newest inventory adjustment',
              '2026-09-18T00:00:00.000Z',
            ),
          ],
          nextCursor: 'page-2',
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/approvals');
  await expect(page.getByText('Newest inventory adjustment').first()).toBeVisible();
  await expect(page.getByText('Older inventory adjustment')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more approvals' }).click();
  await expect(page.getByText('Older inventory adjustment').first()).toBeVisible();
});

test('closes the PIN dialog if the reviewed request disappears during a filter refetch', async ({
  page,
}) => {
  await mockSession(page);
  const firstId = '66666666-6666-4666-8666-666666666666';
  const replacementId = '77777777-7777-4777-8777-777777777777';
  await page.route('**/api/admin/approvals*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, requestId: replacementId, status: 'APPROVED' }),
      });
      return;
    }
    const url = new URL(route.request().url());
    const pendingOnly = url.searchParams.get('status') === 'PENDING';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        approvals: pendingOnly
          ? [approval(replacementId, 'Replacement request', '2026-09-17T23:59:00.000Z')]
          : [
              approval(firstId, 'Reviewed request', '2026-09-18T00:00:00.000Z'),
              approval(replacementId, 'Replacement request', '2026-09-17T23:59:00.000Z'),
            ],
        nextCursor: null,
      }),
    });
  });

  await page.goto('/approvals');
  await expect(page.getByText('Reviewed request').first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.getByLabel('Status').selectOption('PENDING');
  await expect(page.getByText('Replacement request').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('loads audit events beyond the first bounded page using the continuation cursor', async ({
  page,
}) => {
  await mockSession(page);
  await page.route('**/api/admin/audit*', async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get('cursor');
    const payload = cursor
      ? {
          events: [
            auditEvent(
              '99999999-9999-4999-8999-999999999999',
              'OLDER_INVENTORY_ADJUSTMENT',
              '2026-09-17T10:00:00.000Z',
            ),
          ],
          actorOptions: [],
          nextCursor: null,
        }
      : {
          events: [
            auditEvent(
              '88888888-8888-4888-8888-888888888888',
              'NEWEST_INVENTORY_ADJUSTMENT',
              '2026-09-18T00:00:00.000Z',
            ),
          ],
          actorOptions: [],
          nextCursor: 'audit-page-2',
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });

  await page.goto('/audit');
  await expect(page.getByText('NEWEST INVENTORY ADJUSTMENT').first()).toBeVisible();
  await expect(page.getByText('OLDER INVENTORY ADJUSTMENT')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more audit events' }).click();
  await expect(page.getByText('OLDER INVENTORY ADJUSTMENT').first()).toBeVisible();
});
