import type { EmployeeDetail, StaffWorkspace } from '@tux/admin-contracts';
import { expect, test, type Page, type Route } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const employeeId = '22222222-2222-4222-8222-222222222222';
const accountId = '33333333-3333-4333-8333-333333333333';
const csrfToken = 'w'.repeat(64);

const session = {
  principal: {
    employeeId: '44444444-4444-4444-8444-444444444444',
    businessId: '55555555-5555-4555-8555-555555555555',
    role: 'OWNER',
    permissions: ['staff.view', 'staff.manage', 'staff.payments'],
    shopIds: [shopId],
  },
  csrfToken,
};

function workspace(withAccount = true): StaffWorkspace {
  return {
    employees: {
      rows: [
        {
          id: employeeId,
          displayName: 'Mona Ali',
          phone: '+201000000000',
          role: 'STAFF',
          active: true,
          shopIds: [shopId],
          operationsSetupRequiredShopIds: [shopId],
        },
      ],
      nextCursor: null,
    },
    financeAccounts: withAccount
      ? [
          {
            id: accountId,
            shopId,
            accountType: 'CASH',
            name: 'Payroll Cash',
          },
        ]
      : [],
  };
}

function employee(): EmployeeDetail {
  return {
    id: employeeId,
    businessId: session.principal.businessId,
    displayName: 'Mona Ali',
    phone: '+201000000000',
    hireDate: '2026-09-01',
    notes: null,
    role: 'STAFF',
    active: true,
    profileVersion: 2,
    credentialVersion: 3,
    customPermissions: [],
    assignments: [{ shopId, assigned: true }],
    operationsIdentities: [{ kind: 'SETUP_REQUIRED', shopId }],
    compensation: [],
    shifts: [],
    attendanceEvents: [
      {
        id: '66666666-6666-4666-8666-666666666666',
        employeeId,
        shopId,
        workerId: '77777777-7777-4777-8777-777777777777',
        workerSessionId: '88888888-8888-4888-8888-888888888888',
        eventType: 'SESSION_START',
        occurredAt: '2026-09-27T06:00:00.000Z',
        createdAt: '2026-09-27T06:00:00.000Z',
      },
    ],
    attendanceCorrections: [],
    leaveRequests: [],
    payments: [],
  };
}

async function mockWorkforce(page: Page, withAccount = true) {
  const commands: Record<string, unknown>[] = [];

  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
  });

  await page.route('**/api/admin/staff**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'GET') {
      expect(url.searchParams.get('shopId')).toBe(shopId);
      if (url.searchParams.get('employeeId')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ employee: employee() }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workspace(withAccount)),
      });
      return;
    }

    expect(request.method()).toBe('POST');
    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as Record<string, unknown>;
    commands.push(command);

    if (command.type === 'payment.record' && command.financeAccountId !== accountId) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'finance_account_forbidden' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, replayed: false }),
    });
  });

  return commands;
}

test('staff profile exposes Operations setup and posts payment only to a trusted account', async ({
  page,
}) => {
  const commands = await mockWorkforce(page);
  await page.goto('/staff');

  await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
  await expect(page.getByText('Operations identity setup required')).toBeVisible();

  await page.getByRole('button', { name: 'Pay' }).click();
  await expect(page.getByRole('option', { name: /Payroll Cash/ })).toBeVisible();
  await page.getByLabel('Pay period start').fill('2026-09-01');
  await page.getByLabel('Pay period end').fill('2026-09-30');
  await page.getByLabel('Expected amount (EGP)').fill('1200');
  await page.getByLabel('Paid amount (EGP)').fill('1200');
  await page.getByLabel('Payment date').fill('2026-09-30');
  await page.getByRole('button', { name: 'Record payment' }).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'payment.record',
    employeeId,
    shopId,
    financeAccountId: accountId,
    expectedAmountMinor: 120000,
    paidAmountMinor: 120000,
  });
  expect(String(commands[0]?.commandId ?? '')).not.toBe('');
});

test('staff payment shows a clear no-account state instead of inventing an account', async ({
  page,
}) => {
  await mockWorkforce(page, false);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Pay' }).click();

  await expect(page.getByText('No active payment account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});

test('attendance correction posts a separate audited correction command', async ({ page }) => {
  const commands = await mockWorkforce(page);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Attendance' }).click();

  await page.getByLabel('Corrected time').fill('2026-09-27T09:15');
  await page.getByLabel('Reason').fill('Forgot to clock in');
  await page.getByRole('button', { name: 'Record correction' }).click();

  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'attendance.correct',
    attendanceEventId: '66666666-6666-4666-8666-666666666666',
    shopId,
    reason: 'Forgot to clock in',
  });
  expect(commands[0]).not.toHaveProperty('originalOccurredAt');
});
