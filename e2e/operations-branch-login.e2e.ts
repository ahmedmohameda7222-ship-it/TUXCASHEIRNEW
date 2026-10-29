import { pbkdf2Sync } from 'node:crypto';
import { expect, test } from '@playwright/test';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';

test('worker selects branch by name then PIN; browser device remains scoped on branch switch', async ({
  page,
}) => {
  const enrollments: Array<{ shopId: string; deviceId: string; pin: string }> = [];
  await page.route('**/api/device-session', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: '{"status":"NOT_ENROLLED"}',
    }),
  );
  await page.route('**/api/operations-shops', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shops: [
          { id: A, name: 'Downtown' },
          { id: B, name: 'Mall Branch' },
        ],
      }),
    }),
  );
  await page.route('**/api/device-bootstrap', async (route) => {
    enrollments.push(
      route.request().postDataJSON() as { shopId: string; deviceId: string; pin: string },
    );
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"error":"invalid_pin"}',
    });
  });

  await page.goto('/');
  const branches = page.getByRole('combobox', { name: 'Branch' });
  await expect(branches).toBeVisible();
  await expect(branches.locator('option')).toHaveText([
    'Choose your branch',
    'Downtown',
    'Mall Branch',
  ]);
  await expect(page.getByLabel('Shop ID')).toHaveCount(0);
  await branches.selectOption({ label: 'Mall Branch' });
  const pin = page.getByLabel('Enter PIN to Sign In');
  await pin.fill('1234');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('alert').last()).toContainText('Invalid PIN');
  expect(enrollments[0]?.shopId).toBe(B);
  expect(enrollments[0]?.pin).toBe('1234');

  await branches.selectOption({ label: 'Downtown' });
  await pin.fill('1234');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect.poll(() => enrollments.length).toBe(2);
  expect(enrollments[1]?.shopId).toBe(A);
  expect(enrollments[1]?.deviceId).not.toBe(enrollments[0]?.deviceId);

  await branches.selectOption({ label: 'Mall Branch' });
  await pin.fill('1234');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect.poll(() => enrollments.length).toBe(3);
  expect(enrollments[2]?.deviceId).toBe(enrollments[0]?.deviceId);
});

test('a verified PIN opens Operations even when the server menu payload is invalid', async ({
  page,
}) => {
  let signedInDeviceId: string | null = null;
  await page.route('**/api/device-session', (route) =>
    route.fulfill({
      status: signedInDeviceId === null ? 404 : 200,
      contentType: 'application/json',
      body:
        signedInDeviceId === null
          ? JSON.stringify({ error: 'no_device_session' })
          : JSON.stringify({ shopId: A, deviceId: signedInDeviceId }),
    }),
  );
  await page.route('**/api/operations-shops', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ shops: [{ id: A, name: 'tux maadi' }] }),
    }),
  );
  await page.route('**/api/device-bootstrap', async (route) => {
    const body = route.request().postDataJSON() as { deviceId: string };
    signedInDeviceId = body.deviceId;
    const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const digest = pbkdf2Sync('1234', salt, 210_000, 32, 'sha256');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shopId: A,
        deviceId: signedInDeviceId,
        shop: { id: A, name: 'tux maadi', active: true },
        worker: {
          id: '20000000-0000-4000-8000-000000000001',
          shopId: A,
          displayName: 'Test Worker',
          pinHash: `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`,
          active: true,
        },
      }),
    });
  });
  await page.route('**/api/operations-sync*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shopId: A,
        openDayId: null,
        openDay: null,
        openWorkerCount: 0,
        localDayStatus: null,
      }),
    }),
  );
  await page.route('**/api/operations-config*', (route) => {
    const requested = new URL(route.request().url()).searchParams.has('version');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(requested ? { version: 1, bundle: { invalid: true } } : { version: 1 }),
    });
  });
  await page.route('**/api/operations-session-exit', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  await page.goto('/');
  await page.getByRole('combobox', { name: 'Branch' }).selectOption(A);
  await page.getByLabel('Enter PIN to Sign In').fill('1234');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('.welcome-action')).toBeVisible();
  await expect(page.getByText('Could not install the Operations configuration')).toHaveCount(0);
  await page.locator('.welcome-action').click();
  await expect(page.getByRole('heading', { name: 'Orders unavailable' })).toBeVisible();
  await expect(page.getByText('Menu data is syncing.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry menu' })).toBeVisible();
});
