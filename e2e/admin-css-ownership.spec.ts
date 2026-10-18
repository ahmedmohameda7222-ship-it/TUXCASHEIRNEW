import { expect, test, type Page } from '@playwright/test';

const owner = {
  principal: {
    employeeId: 'employee-ui-regression',
    businessId: 'business-ui-regression',
    role: 'OWNER',
    permissions: [
      'orders.view',
      'catalog.view',
      'inventory.view',
      'customers.view',
      'purchasing.view',
      'staff.view',
      'delivery.view',
      'finance.view',
      'reports.view',
      'settings.manage',
      'audit.view',
      'approvals.review',
    ],
    shopIds: ['shop-css-a'],
  },
  csrfToken: 'a'.repeat(64),
};

async function mockAuth(page: Page) {
  await page.route('**/api/admin/session', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(owner) }),
  );
  await page.route('**/api/admin/approval-rules', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rules: [],
        availableActions: [
          {
            actionType: 'ORDER_RETURN',
            label: 'Order return',
            requesterPermission: 'orders.refund',
            thresholdKind: 'minimumQuantityImpact',
          },
        ],
      }),
    }),
  );
}

// Reads actual browser computed styles after the route's lazy chunk has rendered.
async function computedStyles(page: Page) {
  return page.evaluate(() => {
    const field = document.createElement('label');
    field.className = 'admin-field';
    const button = document.createElement('button');
    button.className = 'admin-secondary-button';
    const section = document.createElement('section');
    section.className = 'admin-form-section';
    const record = document.createElement('div');
    record.className = 'admin-record-list';
    const finance = document.createElement('section');
    finance.className = 'tux-finance-position';
    const card = document.createElement('article');
    card.className = 'admin-card';
    const cardGrid = document.createElement('div');
    cardGrid.className = 'admin-card-grid';
    const formGrid = document.createElement('form');
    formGrid.className = 'admin-form-grid';
    const probes = [field, button, section, record, finance, card, cardGrid, formGrid];
    for (const el of probes) document.body.append(el);
    const result = {
      fieldGap: getComputedStyle(field).rowGap,
      buttonBorderStyle: getComputedStyle(button).borderTopStyle,
      buttonBorderWidth: getComputedStyle(button).borderTopWidth,
      sectionBorderWidth: getComputedStyle(section).borderTopWidth,
      sectionPadding: getComputedStyle(section).paddingTop,
      recordBorderWidth: getComputedStyle(record).borderTopWidth,
      financeBorderWidth: getComputedStyle(finance).borderTopWidth,
      cardDisplay: getComputedStyle(card).display,
      cardGap: getComputedStyle(card).rowGap,
      cardGridDisplay: getComputedStyle(cardGrid).display,
      formGridDisplay: getComputedStyle(formGrid).display,
      formGridGap: getComputedStyle(formGrid).rowGap,
    };
    for (const el of probes) el.remove();
    return result;
  });
}

const coldRoutes = [
  '/approvals/rules',
  '/staff',
  '/purchasing',
  '/finance/expenses',
  '/finance/settlements',
  '/finance/end-day',
  '/settings/shop',
] as const;

for (const width of [390, 1440]) {
  test(`cold lazy-route CSS is deterministic at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockAuth(page);
    for (const path of coldRoutes) {
      await page.goto(path);
      await expect(page.locator('.admin-page').first()).toBeVisible();
      const cold = await computedStyles(page);
      expect(cold.fieldGap).not.toBe('normal');
      expect(cold.buttonBorderStyle).toBe('solid');
      expect(cold.buttonBorderWidth).not.toBe('0px');
      expect(cold.sectionBorderWidth).not.toBe('0px');
      expect(cold.sectionPadding).not.toBe('0px');
      expect(cold.recordBorderWidth).not.toBe('0px');
      expect(cold.cardDisplay).toBe('grid');
      expect(cold.cardGap).not.toBe('normal');
      expect(cold.cardGridDisplay).toBe('grid');
      expect(cold.formGridDisplay).toBe('grid');
      expect(cold.formGridGap).not.toBe('normal');
      if (path.startsWith('/finance/')) expect(cold.financeBorderWidth).not.toBe('0px');

      // Visiting Catalog or Finance Overview must not be a prerequisite.
      await page.goto(path.startsWith('/finance/') ? '/finance' : '/catalog/products');
      await expect(page.locator('.admin-page').first()).toBeVisible();
      await page.goto(path);
      await expect(page.locator('.admin-page').first()).toBeVisible();
      const warmed = await computedStyles(page);
      expect(warmed).toEqual(cold);
    }
  });
}
