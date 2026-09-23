import { expect, test, type Page } from '@playwright/test';
import type { AdminDeliveryWorkspace } from '@tux/admin-contracts';

const shopId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const zoneId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const riderId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const csrfToken = 'd'.repeat(64);

const session = {
  principal: {
    employeeId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    businessId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    role: 'OWNER',
    permissions: ['delivery.view', 'delivery.manage'],
    shopIds: [shopId],
  },
  csrfToken,
};

type DeliveryCommand = Record<string, unknown>;

function workspace(): AdminDeliveryWorkspace {
  return {
    shopId,
    zones: [
      {
        id: zoneId,
        shopId,
        name: 'Maadi Core',
        feeMinor: 2500,
        minimumOrderMinor: 12000,
        priority: 20,
        active: true,
        boundary: {
          kind: 'RADIUS',
          latitude: 30.0444,
          longitude: 31.2357,
          radiusMeters: 3000,
        },
        fallbackShopId: null,
        fallbackEnabled: false,
        sortOrder: 20,
        version: 3,
      },
    ],
    riders: [
      {
        id: riderId,
        shopId,
        displayName: 'Omar Rider',
        phone: '+201000000000',
        active: true,
        state: 'AVAILABLE',
        version: 2,
      },
    ],
    orders: [
      {
        orderId,
        shopId,
        riderId,
        state: 'ASSIGNED',
        version: 4,
        updatedAt: '2026-09-23T08:00:00.000Z',
      },
    ],
  };
}

async function mockDelivery(page: Page) {
  const commands: DeliveryCommand[] = [];

  await page.route('**/api/admin/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    }),
  );

  await page.route('**/api/admin/delivery**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(workspace()),
      });
      return;
    }

    expect(request.headers()['x-tux-admin-csrf']).toBe(csrfToken);
    const command = request.postDataJSON() as DeliveryCommand;
    commands.push(command);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        command.type === 'delivery.transition'
          ? {
              ok: true,
              orderId,
              state: command.toState,
              version: 5,
              replayed: false,
            }
          : {
              ok: true,
              version: 4,
              zoneId: command.type === 'delivery.zone.upsert' ? zoneId : undefined,
              riderId: command.type === 'delivery.rider.upsert' ? riderId : undefined,
            },
      ),
    });
  });

  return { commands };
}

test('renders canonical delivery zones, riders, and delivery-order state', async ({ page }) => {
  await mockDelivery(page);
  await page.goto('/delivery');

  await expect(page.getByRole('heading', { name: 'Delivery' })).toBeVisible();
  await expect(page.getByText('Maadi Core')).toBeVisible();
  await expect(page.getByText('25.00 EGP')).toBeVisible();
  await expect(page.getByText('120.00 EGP minimum')).toBeVisible();
  await expect(page.getByText('Omar Rider')).toBeVisible();
  await expect(page.getByLabel(`Delivery order ${orderId})).toContainText('ASSIGNED');
});

test('routes delivery mutations through the trusted BFF and clears rider on unassign', async ({
  page,
}) => {
  const { commands } = await mockDelivery(page);
  await page.goto('/delivery');

  await page.getByRole('button', { name: /Maadi Core/ }).click();
  await page.getByLabel('Delivery fee minor').fill('3000');
  await page.getByRole('button', { name: 'Save delivery zone' }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(1);
  expect(commands[0]).toMatchObject({
    type: 'delivery.zone.upsert',
    shopId,
    zoneId,
    expectedVersion: 3,
    feeMinor: 3000,
    minimumOrderMinor: 12000,
    priority: 20,
  });

  await page.getByLabel(`Delivery order ${orderId}`).getByRole('button', {
    name: 'UNASSIGNED',
  }).click();

  await expect.poll(() => commands.length).toBeGreaterThanOrEqual(2);
  expect(commands[1]).toMatchObject({
    type: 'delivery.transition',
    shopId,
    orderId,
    riderId: null,
    expectedVersion: 4,
    toState: 'UNASSIGNED',
  });
  expect(typeof commands[1]?.commandId).toBe('string');
});
