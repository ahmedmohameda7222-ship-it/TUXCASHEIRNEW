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
