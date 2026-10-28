import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  captureTargetedAcceptance,
  verifyTargetedVisualLayout,
} from './premiumVisualEvidence';
import type { EmployeeDetail, StaffWorkspace } from '@tux/admin-contracts';
import { expect, test, type Page, type Route } from '@playwright/test';
import { ADMIN_CORE_VIEWPORTS } from './adminViewports';

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
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
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
    workers: [],
    shops: [{ id: shopId, name: 'Downtown' }],
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
    attendanceSummaries: [],
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

  await page.route('**/api/admin/reauth', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reauthenticatedAt: '2026-10-28T09:00:00.000Z' }),
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
      body: JSON.stringify({
        ok: true,
        replayed: false,
        ...(command.type === 'employee.create'
          ? { employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
          : {}),
      }),
    });
  });

  return commands;
}

async function selectEmployee(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('S1 mobile directory searches name and phone within explicitly loaded staff', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.has('employeeId')) {
      await route.fallback();
      return;
    }
    const current = workspace();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...current,
        employees: {
          rows: [
            ...current.employees.rows,
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              displayName: 'Youssef Hassan',
              phone: '+201011111111',
              role: 'MANAGER',
              active: false,
              shopIds: [shopId],
              operationsSetupRequiredShopIds: [],
            },
          ],
          nextCursor: 'more-staff-exist',
        },
      }),
    });
  });
  await page.goto('/staff');
  const search = page.getByRole('searchbox', { name: 'Search employees (loaded results)' });
  await expect(search).toBeVisible();
  await expect(page.getByText('Loaded results only')).toBeVisible();
  await search.fill('Youssef');
  await expect(page.getByRole('button', { name: /Youssef Hassan/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toHaveCount(0);
  await search.fill('+201000000000');
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Youssef Hassan/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('S1 loaded-only role and status filters narrow staff without server-side claims', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.searchParams.has('employeeId')) {
      await route.fallback();
      return;
    }
    const current = workspace();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...current,
        employees: {
          rows: [
            ...current.employees.rows,
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              displayName: 'Youssef Hassan',
              phone: '+201011111111',
              role: 'MANAGER',
              active: false,
              shopIds: [shopId],
              operationsSetupRequiredShopIds: [],
            },
          ],
          nextCursor: 'more-staff-exist',
        },
      }),
    });
  });
  await page.goto('/staff');
  const role = page.getByRole('combobox', { name: 'Role (loaded results)' });
  const status = page.getByRole('combobox', { name: 'Status (loaded results)' });
  await expect(role).toBeVisible();
  await expect(status).toBeVisible();
  await role.selectOption('MANAGER');
  await expect(page.getByRole('button', { name: /Youssef Hassan/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toHaveCount(0);
  await status.selectOption('active');
  await expect(page.getByText('No employees match search')).toBeVisible();
  await status.selectOption('suspended');
  await expect(page.getByRole('button', { name: /Youssef Hassan/ })).toBeVisible();
  await role.selectOption('all');
  await status.selectOption('active');
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Youssef Hassan/ })).toHaveCount(0);
  await expect(page.getByText('Loaded results only')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('S1 selected desktop employee keeps directory and inspector adjacent at 1440px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockWorkforce(page);
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  const list = page.locator('.admin-staff-workspace .admin-master-detail__list');
  const detail = page.locator('.admin-staff-workspace .admin-master-detail__detail');
  await expect(list).toBeVisible();
  await expect(detail).toBeVisible();
  const listBounds = await list.boundingBox();
  const detailBounds = await detail.boundingBox();
  expect(listBounds).not.toBeNull();
  expect(detailBounds).not.toBeNull();
  expect(listBounds!.x + listBounds!.width).toBeLessThan(detailBounds!.x + 32);
  expect(Math.abs(listBounds!.y - detailBounds!.y)).toBeLessThan(32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('staff profile exposes Operations setup and posts payment only to a trusted account', async ({
  page,
}) => {
  const commands = await mockWorkforce(page);
  await page.goto('/staff');

  await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Access & Permissions' }).click();
  const accessWorkspaces = page.getByRole('navigation', { name: 'Employee access workspaces' });
  await expect(accessWorkspaces.getByRole('link')).toHaveCount(3);
  await accessWorkspaces.getByRole('link', { name: /Role & permissions/ }).click();
  await expect(page).toHaveURL(/#staff-permission-policy$/);
  await expect(page.getByRole('region', { name: 'Permissions' })).toBeVisible();
  await expect(page.getByText('Operations setup required', { exact: true })).toBeVisible();
  const setup = page.locator('.admin-staff-readiness-state').first();
  await expect(setup).toBeVisible();
  expect(await setup.evaluate((node) => getComputedStyle(node).display)).toBe('grid');
  expect(await setup.evaluate((node) => parseFloat(getComputedStyle(node).rowGap))).toBeGreaterThan(
    0,
  );

  await page.getByRole('tab', { name: 'Pay / Compensation' }).click();
  await expect(page.getByLabel('Payment account')).toHaveValue(accountId);
  await expect(page.getByRole('option', { name: /Payroll Cash/ })).toHaveCount(1);
  await page.getByLabel('Pay period start').fill('2026-09-01');
  await page.getByLabel('Pay period end').fill('2026-09-30');
  await page.getByLabel('Expected amount (EGP)').fill('1200');
  await page.getByLabel('Paid amount (EGP)').fill('1200');
  await page.getByLabel('Payment date').fill('2026-09-30');
  await page.getByLabel('Admin PIN for staff payment').fill('1234');
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

test('S3 rejected shift creation retains original draft and retries without a duplicate', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  let attempts = 0;
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON()?.type !== 'shift.create') {
      await route.fallback();
      return;
    }
    attempts += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        attempts === 1
          ? { ok: false, code: 'shift_schedule_temporarily_unavailable' }
          : { ok: true, replayed: false },
      ),
    });
  });
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Schedule' }).click();
  await page.getByRole('button', { name: 'Add shift' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add shift' });
  await sheet.getByLabel('Starts').fill('2026-10-29T09:00');
  await sheet.getByLabel('Ends').fill('2026-10-29T17:00');
  await sheet.getByRole('button', { name: 'Add shift' }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Starts')).toHaveValue('2026-10-29T09:00');
  await expect(sheet.getByLabel('Ends')).toHaveValue('2026-10-29T17:00');
  await sheet.getByRole('button', { name: 'Add shift' }).click();
  await expect.poll(() => attempts).toBe(2);
  await expect(sheet).toHaveCount(0);
});

test('S4 payroll requires successful Admin PIN reauth before protected payment command', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockWorkforce(page);
  let reauthRequests = 0;
  await page.route('**/api/admin/reauth', async (route) => {
    reauthRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reauthenticatedAt: '2026-10-28T09:00:00.000Z' }),
    });
  });
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Pay / Compensation' }).click();
  await page.getByLabel('Pay period start').fill('2026-10-01');
  await page.getByLabel('Pay period end').fill('2026-10-31');
  await page.getByLabel('Expected amount (EGP)').fill('500.00');
  await page.getByLabel('Paid amount (EGP)').fill('500.00');
  await page.getByLabel('Payment date').fill('2026-10-31');
  const record = page.getByRole('button', { name: 'Record payment' });
  await expect(record).toBeDisabled();
  expect(commands).toHaveLength(0);
  await page.getByLabel('Admin PIN for staff payment').fill('1234');
  await record.click();
  await expect.poll(() => reauthRequests).toBe(1);
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'payment.record',
    expectedAmountMinor: 50000,
    paidAmountMinor: 50000,
    requesterPin: '1234',
  });
});

test('S4 pending payroll approval never claims a posted payment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  let attempts = 0;
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || request.postDataJSON()?.type !== 'payment.record') {
      await route.fallback();
      return;
    }
    attempts += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        state: 'PENDING_APPROVAL',
        approvalRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    });
  });
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Pay / Compensation' }).click();
  await page.getByLabel('Pay period start').fill('2026-10-01');
  await page.getByLabel('Pay period end').fill('2026-10-31');
  await page.getByLabel('Expected amount (EGP)').fill('500.00');
  await page.getByLabel('Paid amount (EGP)').fill('500.00');
  await page.getByLabel('Payment date').fill('2026-10-31');
  await page.getByLabel('Admin PIN for staff payment').fill('1234');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect.poll(() => attempts).toBe(1);
  await expect(page.getByRole('status')).toContainText('Pending second-person approval');
  await expect(page.getByLabel('Paid amount (EGP)')).toHaveValue('500.00');
  await expect(page.getByLabel('Admin PIN for staff payment')).toHaveValue('');
});

test('S3 payment records exact safe minor units without floating-point rounding on phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockWorkforce(page);
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Pay / Compensation' }).click();
  await page.getByLabel('Pay period start').fill('2026-10-01');
  await page.getByLabel('Pay period end').fill('2026-10-31');
  await page.getByLabel('Expected amount (EGP)').fill('90071992547409.90');
  await page.getByLabel('Paid amount (EGP)').fill('90071992547409.90');
  await page.getByLabel('Payment date').fill('2026-10-31');
  await page.getByLabel('Admin PIN for staff payment').fill('1234');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'payment.record',
    expectedAmountMinor: 9007199254740990,
    paidAmountMinor: 9007199254740990,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('staff payment shows a clear no-account state instead of inventing an account', async ({
  page,
}) => {
  await mockWorkforce(page, false);
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Pay / Compensation' }).click();

  await expect(page.getByText('No active payment account')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});

test('attendance correction posts a separate audited correction command', async ({ page }) => {
  const commands = await mockWorkforce(page);
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Attendance' }).click();

  await page.getByRole('button', { name: 'Correct attendance' }).click();
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

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`staff keeps focused tasks reachable without horizontal overflow on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await mockWorkforce(page);
    await page.goto('/staff');

    await expect(page.getByRole('button', { name: 'Add employee' })).toBeVisible();
    await capturePremiumScreenshot(page, 'workforce-list');
    await selectEmployee(page, 'Mona Ali');
    await expect(page.getByRole('tablist', { name: 'Employee detail sections' })).toBeVisible();
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.getByRole('button', { name: 'Add shift' }).click();
    await expect(page.getByRole('dialog', { name: 'Add shift' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);

    if (process.env['P04_P07_CAPTURE'] === '1') {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Add shift' })).toBeHidden();
      await capturePremiumScreenshot(page, 'workforce');
      await page.getByRole('tab', { name: 'Access & Permissions' }).click();
      await capturePremiumScreenshot(page, 'workforce-permissions');
      await page.goto('/staff');
      await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
      await capturePremiumScreenshot(page, 'workforce-list');
    } else if (viewport.width <= 480) {
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: /back/i }).click();
      await expect(page.getByRole('button', { name: /Mona Ali/ })).toBeVisible();
    }
  });
}

for (const viewport of premiumVisualViewports(ADMIN_CORE_VIEWPORTS)) {
  test(`restricted workforce access stays read-only at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const commands = await mockWorkforce(page);
    await page.route('**/api/admin/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...session,
          principal: {
            ...session.principal,
            role: 'MANAGER',
            permissions: ['staff.view'],
          },
        }),
      });
    });
    await page.goto('/staff');
    await selectEmployee(page, 'Mona Ali');
    await page.getByRole('tab', { name: 'Access & Permissions' }).click();
    const tasks = page.getByRole('navigation', { name: 'Employee access workspaces' });
    await expect(tasks.getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Permissions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reset employee PIN' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Complete Operations setup' })).toHaveCount(0);
    await expect(page.locator('.admin-permission-group select').first()).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(commands).toHaveLength(0);
    await capturePremiumScreenshot(page, 'workforce-readonly');
  });
}

test('switching employees resets local profile editor state to the selected employee', async ({
  page,
}) => {
  const secondEmployeeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const first = employee();
  const second: EmployeeDetail = {
    ...employee(),
    id: secondEmployeeId,
    displayName: 'Youssef Hassan',
    phone: '+201011111111',
    profileVersion: 7,
    credentialVersion: 4,
    attendanceEvents: [],
  };

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
    if (request.method() !== 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, replayed: false }),
      });
      return;
    }

    const requestedEmployeeId = url.searchParams.get('employeeId');
    if (requestedEmployeeId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employee: requestedEmployeeId === secondEmployeeId ? second : first,
        }),
      });
      return;
    }

    const base = workspace();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...base,
        employees: {
          rows: [
            base.employees.rows[0],
            {
              id: secondEmployeeId,
              displayName: second.displayName,
              phone: second.phone,
              role: second.role,
              active: second.active,
              shopIds: [shopId],
              operationsSetupRequiredShopIds: [shopId],
            },
          ],
          nextCursor: null,
        },
      }),
    });
  });

  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  const monaProfile = page.getByRole('article', { name: 'Employee Mona Ali' });
  await expect(monaProfile.getByLabel('Name')).toHaveValue('Mona Ali');

  // On desktop the approved master/detail keeps the directory visible;
  // on a phone the same change happens through the focused Back route.
  const directory = page.locator('.admin-staff-workspace .admin-master-detail__list');
  if (!(await directory.isVisible())) {
    await page.getByRole('link', { name: /back to employees/i }).click();
  }
  await selectEmployee(page, 'Youssef Hassan');

  const youssefProfile = page.getByRole('article', { name: 'Employee Youssef Hassan' });
  await expect(youssefProfile.getByLabel('Name')).toHaveValue('Youssef Hassan');
  await expect(youssefProfile.getByLabel('Phone')).toHaveValue('+201011111111');
});

if (process.env['P04_P07_TARGETED_CAPTURE'] === '1') {
  for (const width of [390, 1440] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const entry of ['cold', 'warm'] as const) {
        for (const scene of ['staff', 'permissions'] as const) {
          test(`targeted P06 ${scene} ${theme} ${entry} ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
            await mockWorkforce(page);
            await verifyTargetedVisualLayout(page, {
              route: '/staff',
              heading: 'Staff',
              theme,
              entry,
            });
            if (scene === 'permissions') {
              await selectEmployee(page, 'Mona Ali');
              await page.getByRole('tab', { name: 'Access & Permissions' }).click();
              await expect(page.getByRole('region', { name: 'Permissions' })).toBeVisible();
            }
            await captureTargetedAcceptance(page, 'p06', scene, theme, entry);
          });
        }
      }
    }
  }
}

async function advanceStaffOnboardingToReview(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  for (let step = 0; step < 3; step += 1) {
    if (step === 2) {
      await sheet.getByLabel('New employee Operations PIN').fill('6852');
      await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
      await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
    }
    await sheet.getByRole('button', { name: 'Continue' }).click();
  }
}

test('S2 initial Cairo shift is scheduled inside employee creation before sheet closes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockWorkforce(page);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Amira First Shift');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('Initial shift starts').fill('2026-10-29T09:00');
  await sheet.getByLabel('Initial shift ends').fill('2026-10-29T17:00');
  await sheet.getByLabel('Initial shift break minutes').fill('30');
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Review employee setup')).toBeVisible();
  expect(commands).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect.poll(() => commands.length).toBe(4);
  expect(commands.map((command) => command.type)).toEqual([
    'employee.create',
    'employee.pin',
    'employee.provision-worker',
    'shift.create',
  ]);
  expect(commands[3]).toMatchObject({
    employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shopId,
    startsAt: '2026-10-29T06:00:00.000Z',
    endsAt: '2026-10-29T14:00:00.000Z',
    plannedBreakMinutes: 30,
  });
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Staff onboarding configures a secure PIN and authorized Operations workers before closing', async ({
  page,
}) => {
  const secondShop = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const commands: Record<string, unknown>[] = [];
  const reauthRequests: Record<string, unknown>[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  await page.route('**/api/admin/reauth', async (route) => {
    reauthRequests.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, reauthenticatedAt: '2026-10-28T11:00:00.000Z' }),
    });
  });
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...session,
        principal: {
          ...session.principal,
          shopIds: [shopId, secondShop],
          shopSummaries: [
            ...session.principal.shopSummaries,
            { id: secondShop, name: 'TUX Mall', active: true, temporaryClosed: false },
          ],
        },
      }),
    });
  });
  await page.route('**/api/admin/staff**', async (route) => {
    if (
      route.request().method() === 'GET' &&
      !new URL(route.request().url()).searchParams.has('employeeId')
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...workspace(),
          shops: [
            { id: shopId, name: 'Downtown' },
            { id: secondShop, name: 'Mall' },
          ],
        }),
      });
      return;
    }
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as Record<string, unknown>;
    commands.push(command);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        replayed: false,
        ...(command.type === 'employee.create'
          ? { employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
          : {}),
      }),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Hana Access');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('checkbox', { name: 'Mall' }).check();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Review employee setup')).toBeVisible();
  await expect(sheet.getByText('Operations PIN and worker access')).toBeVisible();
  expect(commands).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect.poll(() => commands.length).toBe(5);
  expect(commands.map((command) => command.type)).toEqual([
    'employee.create',
    'employee.assign-shop',
    'employee.pin',
    'employee.provision-worker',
    'employee.provision-worker',
  ]);
  expect(reauthRequests).toHaveLength(1);
  expect(commands[2]).toMatchObject({
    type: 'employee.pin',
    newPin: '6852',
    employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shopId,
  });
  expect(commands.slice(3).map((command) => command.shopId)).toEqual([shopId, secondShop]);
  await expect(sheet).toHaveCount(0);
});

test('Selected employee on phone uses a focused inspector without duplicate Staff header and KPIs', async ({
  page,
}) => {
  await mockWorkforce(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await expect(page.locator('.admin-page > .admin-page__header')).toBeHidden();
  await expect(page.locator('.admin-metric-strip[aria-label="Staff summary"]')).toBeHidden();
  await expect(page.getByRole('link', { name: /Back to employees/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mona Ali' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.admin-page > .admin-page__header')).toBeVisible();
  await expect(page.locator('.admin-metric-strip[aria-label="Staff summary"]')).toBeVisible();
});

test('S1 approved Access inspector places six readable facts below permissions at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  await page.goto('/staff');
  await selectEmployee(page, 'Mona Ali');
  await page.getByRole('tab', { name: 'Access & Permissions' }).click();
  const policy = page.locator('.admin-staff-access-policy');
  const activity = page.locator('section[aria-label="Staff factual metrics"]');
  const cards = activity.locator('.admin-more-card');
  await expect(cards).toHaveCount(6);
  const columns = await activity
    .locator('.admin-more-grid')
    .evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length);
  expect(columns).toBe(2);
  const policyBox = await policy.boundingBox();
  const activityBox = await activity.boundingBox();
  expect(policyBox).not.toBeNull();
  expect(activityBox).not.toBeNull();
  expect(activityBox!.y).toBeGreaterThanOrEqual(policyBox!.y + policyBox!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('Staff detail Access layout follows approved compact grid without overlap at 390 and 1440', async ({
  page,
}) => {
  await mockWorkforce(page);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/staff');
    await selectEmployee(page, 'Mona Ali');
    await page.getByRole('tab', { name: 'Access & Permissions' }).click();
    const policy = page.locator('.admin-staff-access-policy .admin-more-grid').first();
    const grid = await policy.evaluate((node) => getComputedStyle(node).gridTemplateColumns);
    expect(grid.trim().split(/\s+/).length).toBe(width === 390 ? 1 : 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await expect(page.getByRole('region', { name: 'Permissions' })).toBeVisible();
  }
});

test('S2 onboarding reviews authorized shops before creating and assigning employee', async ({
  page,
}) => {
  const otherShopId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await page.setViewportSize({ width: 390, height: 844 });
  const commands: Record<string, unknown>[] = [];
  await mockWorkforce(page);
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...session,
        principal: {
          ...session.principal,
          shopIds: [shopId, otherShopId],
          shopSummaries: [
            ...session.principal.shopSummaries,
            { id: otherShopId, name: 'TUX Mall', active: true, temporaryClosed: false },
          ],
        },
      }),
    });
  });
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && !url.searchParams.has('employeeId')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...workspace(),
          shops: [
            { id: shopId, name: 'Downtown' },
            { id: otherShopId, name: 'Mall' },
          ],
        }),
      });
      return;
    }
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = request.postDataJSON() as Record<string, unknown>;
    commands.push(command);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        replayed: false,
        ...(command.type === 'employee.create'
          ? { employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
          : {}),
      }),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  const steps = sheet.getByRole('navigation', { name: 'Employee onboarding steps' });
  await expect(steps).toContainText('Identity');
  await expect(steps).toContainText('Shops');
  await expect(steps).toContainText('Employment');
  await expect(steps).toContainText('Review');
  await sheet.getByLabel('Name').fill('Amira Onboarding');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Select assigned shops')).toBeVisible();
  await sheet.getByRole('checkbox', { name: 'Mall' }).check();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Employment setup')).toBeVisible();
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Review employee setup')).toBeVisible();
  expect(commands).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect.poll(() => commands.length).toBe(5);
  expect(commands[0]).toMatchObject({
    type: 'employee.create',
    shopId,
    displayName: 'Amira Onboarding',
  });
  expect(commands[1]).toMatchObject({
    type: 'employee.assign-shop',
    employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    shopId: otherShopId,
  });
  await expect(sheet).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('S2 partial compensation failure resumes after closing without duplicate employee', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  const commands: Array<{ type?: string; commandId?: string }> = [];
  let compensationAttempts = 0;
  await page.route('**/api/admin/staff**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as {
      type?: string;
      commandId?: string;
    };
    if (command.type !== 'employee.create' && command.type !== 'compensation.set') {
      await route.fallback();
      return;
    }
    commands.push(command);
    if (command.type === 'compensation.set') compensationAttempts += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        command.type === 'compensation.set' && compensationAttempts === 1
          ? { ok: false, code: 'compensation_temporarily_unavailable' }
          : {
              ok: true,
              replayed: false,
              ...(command.type === 'employee.create'
                ? { employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
                : {}),
            },
      ),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  let sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Amira Resumable');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('Rate (EGP, optional)').fill('100.00');
  await sheet.getByLabel('Effective from').fill('2026-10-01');
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect(sheet.getByRole('alert')).toContainText('compensation temporarily unavailable');
  await expect.poll(() => commands.length).toBe(2);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'Add employee' }).click();
  sheet = page.getByRole('dialog', { name: 'Add employee' });
  await expect(sheet.getByText('Review employee setup')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Resume onboarding' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Resume onboarding' }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands.map((command) => command.type)).toEqual([
    'employee.create',
    'compensation.set',
    'compensation.set',
  ]);
  expect(commands[2]?.commandId).toBe(commands[1]?.commandId);
  await expect(sheet).toHaveCount(0);
});

test('S2 rejected employee creation retries the same idempotency intent on phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  const attempts: string[] = [];
  await page.route('**/api/admin/staff**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as {
      type?: string;
      commandId?: string;
    };
    if (command.type !== 'employee.create') {
      await route.fallback();
      return;
    }
    attempts.push(command.commandId ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        attempts.length === 1
          ? { ok: false, code: 'staff_store_temporarily_unavailable' }
          : {
              ok: true,
              employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              replayed: false,
            },
      ),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Amira Retries');
  await advanceStaffOnboardingToReview(page);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByRole('alert')).toContainText('staff store temporarily unavailable');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[0]).toBeTruthy();
  expect(attempts[1]).toBe(attempts[0]);
  await expect(sheet).toHaveCount(0);
});

test('rejected employee creation preserves the Add employee sheet and does not claim success', async ({
  page,
}) => {
  await mockWorkforce(page);
  await page.route('**/api/admin/staff**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const draft = route.request().postDataJSON() as { type?: string };
    if (draft.type !== 'employee.create') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, code: 'employee_already_exists' }),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Existing Employee');
  await advanceStaffOnboardingToReview(page);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Existing Employee')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('employee already exists');
});

test('new employee sheet persists actual hire date and notes through the trusted create command', async ({
  page,
}) => {
  const commands = await mockWorkforce(page);
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Amira QA');
  await sheet.getByLabel('Phone').fill('+201098765432');
  await sheet.getByLabel('Hire date').fill('2026-10-01');
  await sheet.getByLabel('Internal notes').fill('Cross-trained at counter');
  await advanceStaffOnboardingToReview(page);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect
    .poll(() => commands.some((command) => command['type'] === 'employee.create'))
    .toBe(true);
  expect(commands.find((command) => command['type'] === 'employee.create')).toMatchObject({
    shopId,
    displayName: 'Amira QA',
    phone: '+201098765432',
    hireDate: '2026-10-01',
    notes: 'Cross-trained at counter',
    role: 'STAFF',
  });
});

test('S2 pending approval resumes worker provisioning without duplicating employee or PIN', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  const submitted: string[] = [];
  let approvalApplied = false;
  await page.route('**/api/admin/staff**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = route.request().postDataJSON() as { type: string };
    submitted.push(command.type);
    const response =
      command.type === 'employee.create'
        ? { ok: true, employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }
        : command.type === 'employee.pin'
          ? {
              ok: true,
              state: 'PENDING_APPROVAL',
              approvalRequestId: '99999999-9999-4999-8999-999999999999',
            }
          : command.type === 'employee.provision-worker' && !approvalApplied
            ? { ok: false, code: 'employee_pin_not_configured' }
            : { ok: true, state: 'APPLIED' };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Pending Access');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Create employee' }).click();

  await expect(sheet.getByRole('alert')).toContainText(/approval/i);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Resume after approval' })).toBeEnabled();
  expect(submitted).toEqual(['employee.create', 'employee.pin']);

  approvalApplied = true;
  await sheet.getByRole('button', { name: 'Resume after approval' }).click();
  await expect(sheet).toHaveCount(0);
  expect(submitted).toEqual(['employee.create', 'employee.pin', 'employee.provision-worker']);
});

test('S2 owner cannot save an Operations-unready employee without entering a secure PIN', async ({
  page,
}) => {
  const commands = await mockWorkforce(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Ready On Save');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByRole('alert')).toContainText('employee PIN required');
  await expect(sheet.getByText('Employment setup')).toBeVisible();
  expect(commands).toHaveLength(0);
});

test('S2 configures selected role and module permission inside Add employee before Save finishes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkforce(page);
  const sent: Array<Record<string, unknown>> = [];
  let currentRole = 'STAFF';
  let currentVersion = 2;
  let denied = false;
  const newId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await page.route('**/api/admin/staff**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.searchParams.has('employeeId')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          employee: {
            ...employee(),
            id: newId,
            displayName: 'Access Before Save',
            role: currentRole,
            profileVersion: currentVersion,
            customDeniedPermissions: denied ? ['orders.view'] : [],
          },
        }),
      });
      return;
    }
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    const command = request.postDataJSON() as Record<string, unknown>;
    sent.push(command);
    if (command.type === 'employee.role') {
      expect(command.expectedVersion).toBe(2);
      currentRole = 'MANAGER';
      currentVersion += 1;
    }
    if (command.type === 'employee.permission') {
      expect(command.expectedVersion).toBe(3);
      expect(command.permissionKey).toBe('orders.view');
      expect(command.effect).toBe('DENY');
      denied = true;
      currentVersion += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        state: 'APPLIED',
        ...(command.type === 'employee.create' ? { employeeId: newId } : {}),
      }),
    });
  });
  await page.goto('/staff');
  await page.getByRole('button', { name: 'Add employee' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add employee' });
  await sheet.getByLabel('Name').fill('Access Before Save');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await sheet.getByLabel('New employee Operations PIN').fill('6852');
  await sheet.getByLabel('Confirm employee Operations PIN').fill('6852');
  await sheet.getByLabel('Your Admin PIN to authorize setup').fill('1234');
  await sheet.getByLabel('Employee role').selectOption('MANAGER');
  await sheet.getByText('Customize module permissions').click();
  await sheet.getByLabel('Orders · View').selectOption('DENY');
  await sheet.getByRole('button', { name: 'Continue' }).click();
  await expect(sheet.getByText('Review employee setup')).toBeVisible();
  expect(sent).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Create employee' }).click();
  await expect(sheet).toHaveCount(0);
  expect(sent.map((command) => command.type)).toEqual([
    'employee.create',
    'employee.pin',
    'employee.provision-worker',
    'employee.role',
    'employee.permission',
  ]);
  for (const sensitive of sent.filter((command) =>
    ['employee.pin', 'employee.role', 'employee.permission'].includes(String(command.type)),
  )) {
    expect(sensitive.requesterPin).toBe('1234');
  }
});
