import { expect, test, type Page } from '@playwright/test';

const shopId = '11111111-1111-4111-8111-111111111111';
const businessDayId = '22222222-2222-4222-8222-222222222222';
const cashAccountId = '33333333-3333-4333-8333-333333333333';
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

async function mockFinance(page: Page, dayStatus: 'OPEN' | 'CLOSED' = 'OPEN') {
  const postedCommands: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
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
        body: JSON.stringify({ ok: true, replayed: false, commandId: command.commandId }),
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
      data = { snapshots: [], adjustments: [] };
    } else if (view === 'cashiers') {
      data = { workers: [], cashiers: [], reconciliations: [] };
    } else if (view === 'owner-summary') {
      data = { summaries: [] };
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

test('an OPEN Operations Business Day exposes non-closing X and never a Financial Z button', async ({
  page,
}) => {
  const commands = await mockFinance(page, 'OPEN');
  await page.goto('/finance/end-day');
  await expect(page.getByRole('heading', { name: 'X Report / Financial End Day' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Non-closing X report' })).toBeVisible();
  await expect(page.getByText('Operations must close this Business Day first.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalize financial Z' })).toHaveCount(0);
  expect(commands).toHaveLength(0);
});

for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 960 }]) {
  test(`finance viewport ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await mockFinance(page);
    await page.goto('/finance');
    await expect(page.getByText('Total tracked money')).toBeVisible();
    await expect(page.getByText('Estimated Operating Profit')).toBeVisible();
  });
}
