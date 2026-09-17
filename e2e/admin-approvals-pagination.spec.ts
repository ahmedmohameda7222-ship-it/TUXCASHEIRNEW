import { expect, test } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';

const ownerSession = {
  principal: {
    employeeId: '33333333-3333-4333-8333-333333333333',
    businessId: '44444444-4444-4444-8444-444444444444',
    role: 'OWNER',
    permissions: ['approvals.review'],
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

test('loads approvals beyond the first bounded page using the continuation cursor', async ({ page }) => {
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ownerSession),
    });
  });
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
