import {
  capturePremiumScreenshot,
  premiumVisualViewports,
  PREMIUM_EVIDENCE_VIEWPORTS,
} from './premiumVisualEvidence';
import { expect, test, type Page } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const businessDayId = '22222222-2222-4222-8222-222222222222';
const cashAccountId = '33333333-3333-4333-8333-333333333333';
const cashierWorkerId = '77777777-7777-4777-8777-777777777777';
const bankAccountId = '44444444-4444-4444-8444-444444444444';
const csrfToken = 'f'.repeat(64);
const session = {
  principal: {
    employeeId: '55555555-5555-4555-8555-555555555555',
    businessId: '66666666-6666-4666-8666-666666666666',
    role: 'OWNER',
    permissions: [
      'finance.view',
      'finance.adjust',
      'finance.reconcile',
      'finance.manage_accounts',
      'reports.view',
      'settings.manage',
    ],
    shopIds: [shopId],
    shopSummaries: [{ id: shopId, name: 'TUX Maadi', active: true, temporaryClosed: false }],
  },
  csrfToken,
};

const workspace = {
  setupState: 'READY',
  accounts: [
    {
      id: cashAccountId,
      name: 'Till cash',
      accountType: 'CASH',
      shopId,
      active: true,
      openingBalanceMinor: 0,
      balanceMinor: 72000,
      version: 1,
    },
    {
      id: bankAccountId,
      name: 'Branch bank',
      accountType: 'BANK',
      shopId,
      active: true,
      openingBalanceMinor: 0,
      balanceMinor: 300000,
      version: 1,
    },
  ],
  paymentMethods: [],
  moneyPosition: {
    totalTrackedMoneyMinor: 372000,
    cashMinor: 72000,
    bankMinor: 300000,
    walletMinor: 0,
    pendingSettlementMinor: 0,
  },
  profitSummary: {
    netSalesMinor: 500000,
    cogsMinor: 110000,
    expensesMinor: 24000,
    estimatedOperatingProfitMinor: 366000,
  },
  unmappedPaymentMethodCount: 0,
};

async function mockFinance(
  page: Page,
  dayStatus: 'OPEN' | 'CLOSED' = 'OPEN',
  options: {
    pendingSnapshot?: boolean;
    pendingWithdrawal?: boolean;
    pendingCashier?: boolean;
  } = {},
) {
  const postedCommands: Array<Record<string, unknown>> = [];
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
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route('**/api/admin/finance**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const view = url.searchParams.get('view');
    if (request.method() === 'POST') {
      expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
      const command = request.postDataJSON() as Record<string, unknown>;
      postedCommands.push(command);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          (options.pendingSnapshot && command.type === 'finance.snapshot.adjust') ||
            (options.pendingWithdrawal && command.type === 'finance.owner-withdrawal') ||
            (options.pendingCashier && command.type === 'finance.cashier.reconcile')
            ? {
                ok: true,
                state: 'PENDING_APPROVAL',
                approvalRequestId: 'f0000000-0000-4000-8000-000000000004',
              }
            : { ok: true, replayed: false, commandId: command.commandId },
        ),
      });
      return;
    }
    expect(url.searchParams.get('shopId')).toBe(shopId);
    let data: unknown = workspace;
    if (view === 'days') {
      data = {
        days: [
          {
            id: businessDayId,
            shop_id: shopId,
            status: dayStatus,
            started_at: '2026-10-08T06:00:00.000Z',
            ended_at: dayStatus === 'CLOSED' ? '2026-10-08T16:00:00.000Z' : null,
          },
        ],
      };
    } else if (view === 'day') {
      expect(url.searchParams.get('businessDayId')).toBe(businessDayId);
      data = {
        ok: true,
        shopId,
        businessDayId,
        businessDayStatus: dayStatus,
        startedAt: '2026-10-08T06:00:00.000Z',
        endedAt: dayStatus === 'CLOSED' ? '2026-10-08T16:00:00.000Z' : null,
        orderCount: 3,
        netSalesMinor: 120000,
        postedRefundsMinor: 1000,
        cashSalesNetMinor: 73000,
        totalExpensesMinor: 14000,
        cogsMinor: 36000,
        estimatedOperatingProfitMinor: 70000,
        missingInventoryCostCount: 0,
        unattributedPaymentCount: 0,
        missingCashierReconciliationCount: 0,
        paymentBreakdown: { Cash: 74000, Card: 47000 },
        cashierReconciliations: [],
        financialFinalized: false,
      };
    } else if (view === 'day-history') {
      data = options.pendingSnapshot
        ? {
            snapshots: [
              {
                id: 'e0000000-0000-4000-8000-000000000001',
                business_day_id: businessDayId,
                finalized_at: '2026-10-08T16:00:00Z',
                snapshot: {
                  startedAt: '2026-10-08T06:00:00Z',
                  netSalesMinor: 120000,
                  estimatedOperatingProfitMinor: 70000,
                },
              },
            ],
            adjustments: [],
          }
        : { snapshots: [], adjustments: [] };
    } else if (view === 'cashiers') {
      data = options.pendingCashier
        ? {
            workers: [{ id: cashierWorkerId, display_name: 'Cashier #1' }],
            cashiers: [
              {
                cashierWorkerId,
                displayName: 'Cashier #1',
                expectedMinor: 2000,
                cashSalesExpectationMinor: 2000,
                recordedCashMovementMinor: 0,
                openingFloatRecorded: true,
              },
            ],
            reconciliations: [],
          }
        : { workers: [], cashiers: [], reconciliations: [] };
    } else if (view === 'owner-summary') {
      data = { summaries: [] };
    } else if (view === 'expenses') {
      data = { expenses: [] };
    } else if (view === 'categories') {
      data = { categories: [] };
    } else if (view === 'recurring') {
      data = { rules: [], due: [] };
    } else if (view === 'settlements') {
      data = { settlements: [] };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
  return postedCommands;
}

test('Bank & Cash keeps tracked money distinct from profit and posts a transfer command', async ({
  page,
}) => {
  const commands = await mockFinance(page);
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Bank & Cash' })).toBeVisible();
  await expect(page.getByText('Total tracked money')).toBeVisible();
  await expect(page.getByText('Estimated Operating Profit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Money movement' })).toBeVisible();
  await page.getByRole('button', { name: 'Money movement' }).click();
  await expect(
    page.getByText('Internal transfers do not create sales or operating profit.'),
  ).toBeVisible();
  await page.getByLabel('From account').selectOption(cashAccountId);
  await page.getByLabel('To account').selectOption(bankAccountId);
  await page.getByLabel('Amount (EGP)').fill('20.00');
  await page.getByLabel('Reason').fill('Move tills to bank');
  await page.getByRole('button', { name: 'Record movement' }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({
    type: 'finance.transfer',
    shopId,
    fromAccountId: cashAccountId,
    toAccountId: bankAccountId,
    amountMinor: 2000,
    reason: 'Move tills to bank',
  });
  expect(commands[0]?.commandId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test('cashier variance approval remains pending without falsely posting a count', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockFinance(page, 'CLOSED', { pendingCashier: true });
  await page.goto('/finance/end-day');
  await page
    .getByRole('navigation', { name: 'End day workflow' })
    .getByRole('link', { name: /Cashier counts/ })
    .click();
  await page.getByRole('button', { name: 'Record cashier count' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cashier cash count' });
  await dialog.getByLabel('Cashier', { exact: true }).selectOption(cashierWorkerId);
  await dialog.getByLabel('Actual counted cash (EGP)').fill('25.00');
  await dialog.getByLabel('Variance reason, if different').fill('Verified drawer difference');
  await dialog.getByLabel('Requester PIN (if approval requires reauthentication)').fill('1234');
  await dialog.getByRole('button', { name: 'Record count' }).click();
  await expect(
    dialog.getByRole('status').filter({ hasText: 'pending second-person approval' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Pending second-person approval' }),
  ).toBeDisabled();
  await expect(
    page.getByText('No cashier reconciliation has been posted for this day.'),
  ).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: 'finance.cashier.reconcile',
    shopId,
    businessDayId,
    cashierWorkerId,
    actualMinor: 2500,
    reason: 'Verified drawer difference',
    requesterPin: '1234',
  });
});

test('owner withdrawal requests second-person approval without posting funds', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockFinance(page, 'OPEN', { pendingWithdrawal: true });
  await page.goto('/finance');
  await page.getByRole('button', { name: 'Money movement' }).click();
  await page.getByLabel('Movement type').selectOption('OWNER_WITHDRAWAL');
  await page.getByLabel('Account', { exact: true }).selectOption(cashAccountId);
  await page.getByLabel('Amount (EGP)').fill('5.00');
  await page.getByLabel('Reason').fill('Owner distribution');
  await page.getByLabel('PIN re-authentication').fill('1234');
  await page.getByRole('button', { name: 'Record movement' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Record money movement' }).getByRole('status'),
  ).toContainText('pending second-person approval');
  await expect(page.getByText('Total tracked money')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record movement' })).toBeDisabled();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: 'finance.owner-withdrawal',
    shopId,
    accountId: cashAccountId,
    amountMinor: 500,
    reason: 'Owner distribution',
    requesterPin: '1234',
  });
});

test('Finance Z correction shows pending approval without claiming a posted adjustment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands = await mockFinance(page, 'CLOSED', { pendingSnapshot: true });
  await page.goto('/finance/end-day');
  await page
    .getByRole('navigation', { name: 'End day workflow' })
    .getByRole('link', { name: /History/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Financial Z history' })).toBeVisible();
  await page.getByRole('button', { name: 'Append correction' }).first().click();
  await page.getByLabel('Adjustment amount (EGP, signed)').fill('5.00');
  await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Correct till value');
  await page
    .getByRole('dialog', { name: 'Append financial correction' })
    .getByLabel('PIN confirmation')
    .fill('1234');
  await page.getByRole('button', { name: 'Append correction' }).last().click();

  await expect(page.getByRole('status')).toContainText('pending second-person approval');
  await expect(page.getByText('Posted adjustments: EGP 0.00')).toBeVisible();
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: 'finance.snapshot.adjust',
    shopId,
    snapshotId: 'e0000000-0000-4000-8000-000000000001',
    amountMinor: 500,
    reason: 'Correct till value',
    requesterPin: '1234',
  });
});

test('an OPEN Operations Business Day exposes non-closing X and never a Financial Z button', async ({
  page,
}) => {
  const commands = await mockFinance(page, 'OPEN');
  await page.goto('/finance/end-day');
  await expect(page.getByRole('heading', { name: 'X Report / Financial End Day' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Non-closing X report' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'End day workflow' })
    .getByRole('link', { name: /Financial Z/ })
    .click();
  await expect(page.getByText('Operations must close this Business Day first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalize financial Z' })).toHaveCount(0);
  expect(commands).toHaveLength(0);
});

for (const vp of premiumVisualViewports([
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1440, height: 960 },
])) {
  test(`finance viewport ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockFinance(page);
    await page.goto('/finance');
    await expect(page.getByText('Total tracked money')).toBeVisible();
    await expect(page.getByText('Estimated Operating Profit')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await capturePremiumScreenshot(page, 'finance');
  });
}

test('end-day workspaces expose keyboard-reachable X, cashier, Z, and history tasks without posting', async ({
  page,
}) => {
  const commands = await mockFinance(page, 'CLOSED', { pendingCashier: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/finance/end-day');
  const tasks = page.getByRole('navigation', { name: 'End day workflow' });
  await expect(tasks.getByRole('link')).toHaveCount(4);
  await expect(tasks.getByRole('link', { name: /X report/ })).toHaveAttribute(
    'aria-current',
    'location',
  );
  await tasks.getByRole('link', { name: /Cashier counts/ }).click();
  await expect(page.getByRole('heading', { name: 'Non-closing X report' })).toBeHidden();
  await expect(page).toHaveURL(/#end-day-cashier$/);
  await expect(page.locator('#end-day-cashier')).toBeVisible();
  await tasks.getByRole('link', { name: /Financial Z/ }).click();
  await expect(page.locator('#end-day-z')).toContainText('Finalization requires');
  await tasks.getByRole('link', { name: /History/ }).click();
  await expect(page.getByRole('heading', { name: 'Financial Z history' })).toBeVisible();
  expect(commands).toHaveLength(0);
});

test('cold End Day history hash directly opens the read-only history workspace', async ({
  page,
}) => {
  const commands = await mockFinance(page, 'CLOSED');
  await page.goto('/finance/end-day#end-day-history');
  await expect(page.getByRole('heading', { name: 'Financial Z history' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Non-closing X report' })).toBeHidden();
  await expect(page.getByRole('link', { name: /History/ })).toHaveAttribute(
    'aria-current',
    'location',
  );
  expect(commands).toHaveLength(0);
});

test('expense due workspaces separate recurring, history and category setup without posting', async ({
  page,
}) => {
  const commands = await mockFinance(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/finance/expenses');
  const tasks = page.getByRole('navigation', { name: 'Expense workspaces' });
  await expect(tasks.getByRole('link')).toHaveCount(3);
  await tasks.getByRole('link', { name: /Due & recurring/ }).click();
  await expect(page).toHaveURL(/#expense-recurring$/);
  await expect(page.getByRole('region', { name: 'Due and recurring expenses' })).toContainText(
    'Recurring expenses',
  );
  await tasks.getByRole('link', { name: /Expense history/ }).click();
  await expect(page.getByRole('region', { name: 'Posted expense history' })).toBeVisible();
  await tasks.getByRole('link', { name: /Categories/ }).click();
  await page.getByRole('button', { name: 'Add expense category' }).click();
  await expect(page.getByRole('dialog', { name: 'New expense category' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(commands).toHaveLength(0);
});

// These scenes use the same isolated finance fixture as the command-regression tests.
if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    for (const scene of [
      { route: '/finance/expenses', id: 'expenses', heading: 'Expenses' },
      { route: '/finance/settlements', id: 'settlements', heading: 'Settlements' },
      { route: '/finance/end-day', id: 'end-day', heading: 'X Report / Financial End Day' },
    ] as const) {
      test(`finance scene ${scene.id} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await mockFinance(page, 'CLOSED');
        await page.goto(scene.route);
        await expect(page.getByRole('heading', { name: scene.heading, exact: true })).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await capturePremiumScreenshot(page, scene.id);
      });
    }
  }
}

// Mock-finance Chromium scenes: no actual ledger command is invoked.
if (process.env['P04_P07_CAPTURE'] === '1') {
  for (const viewport of PREMIUM_EVIDENCE_VIEWPORTS) {
    for (const scenario of [
      { label: 'cashier', link: 'Cashier counts', heading: 'Cashier counts' },
      { label: 'z', link: 'Financial Z', heading: 'Financial Z · finalization' },
      { label: 'history', link: 'History', heading: 'Financial Z history' },
    ] as const) {
      test(`end day task scene ${scenario.label} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        const commands = await mockFinance(page, 'CLOSED');
        await page.goto('/finance/end-day');
        await page
          .getByRole('navigation', { name: 'End day workflow' })
          .getByRole('link', { name: new RegExp(scenario.link) })
          .click();
        await expect(
          page.getByRole('heading', { name: scenario.heading, exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        expect(commands).toHaveLength(0);
        await capturePremiumScreenshot(page, 'end-day-' + scenario.label);
      });
    }
  }
}
