import { expect, test } from '@playwright/test';
import {
  SHOP,
  WORKER,
  WORKER_TWO,
  enterActiveOrders,
  minimalConfiguration,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
  switchWorker,
} from './worker-system-color-test-helpers';

const REMOTE_ORIGIN = 'http://tux.localhost:4173';

interface PendingPreference {
  readonly workerId: string;
  readonly release: (accentColor: string | null, version: number) => Promise<void>;
}

test('late remote preferences update the active UI and worker switches queue the newest identity', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  const configuration = minimalConfiguration();
  const pending: PendingPreference[] = [];

  await page.route('**/api/device-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        shopId: SHOP,
        deviceId: '90000000-0000-4000-8000-000000000001',
      }),
    });
  });

  await page.route('**/api/operations-config**', async (route) => {
    const url = new URL(route.request().url());
    const body = url.searchParams.has('version')
      ? { version: 1, bundle: configuration }
      : { version: 1 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  await page.route('**/api/worker-ui-preferences**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 500, body: 'Unexpected preference mutation' });
      return;
    }
    const url = new URL(route.request().url());
    const workerId = url.searchParams.get('workerId') ?? '';
    await new Promise<void>((resolve) => {
      pending.push({
        workerId,
        release: async (accentColor, version) => {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              shopId: SHOP,
              workerId,
              categoryOrder: [],
              categoryAlignment: 'left',
              productOrder: [],
              accentColor,
              serverVersion: version,
              updatedAt: `2026-08-29T10:0${version}:00.000Z`,
            }),
          });
          resolve();
        },
      });
    });
  });

  await enterActiveOrders(page, REMOTE_ORIGIN);
  const defaultAccent = await renderedSystemAccent(page);
  await expect.poll(() => pending.filter((request) => request.workerId === WORKER).length).toBe(1);
  await pending.shift()!.release('#1E3A8A', 2);
  await expect(page.locator('html')).toHaveAttribute('data-tux-custom-accent', 'true');
  const remoteBlue = await renderedSystemAccent(page);
  expect(remoteBlue).not.toBe(defaultAccent);

  const dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#7e22ce');
  const visibleDraft = await renderedSystemAccent(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => pending.length).toBe(1);
  await pending[0]!.release('#DC2626', 3);
  pending.shift();
  await expect.poll(() => renderedSystemAccent(page)).toBe(visibleDraft);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const latestRemoteA = await renderedSystemAccent(page);
  expect(latestRemoteA).not.toBe(visibleDraft);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => pending.length).toBe(1);
  expect(pending[0]!.workerId).toBe(WORKER);
  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two');
  await pending[0]!.release('#1E3A8A', 4);
  pending.shift();

  await expect.poll(() => pending.some((request) => request.workerId === WORKER_TWO)).toBe(true);
  const workerTwoRequest = pending.find((request) => request.workerId === WORKER_TWO)!;
  await workerTwoRequest.release('#7E22CE', 5);
  pending.splice(pending.indexOf(workerTwoRequest), 1);
  const workerTwoAccent = await renderedSystemAccent(page);
  expect(workerTwoAccent).not.toBe(latestRemoteA);
  await expect(page.getByRole('button', { name: /Demo Worker Two/ })).toBeVisible();
});
