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

async function selectEmployee(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

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

  // Workforce detail is a full-width task surface; navigate back before
  // changing employees, then verify the replacement editor state is clean.
  await page.getByRole('link', { name: /back to employees/i }).click();
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
  await sheet.getByRole('button', { name: 'Add employee' }).click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Name')).toHaveValue('Existing Employee');
  await expect(page.getByRole('alert')).toContainText('employee already exists');
});
