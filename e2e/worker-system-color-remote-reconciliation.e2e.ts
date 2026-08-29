import { expect, test, type Route } from '@playwright/test';
import {
  DATABASE,
  SHOP,
  WORKER,
  WORKER_TWO,
  enterActiveOrders,
  minimalConfiguration,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
  setWorkerAppearance,
  switchWorker,
} from './worker-system-color-test-helpers';

const REMOTE_ORIGIN = 'http://tux.localhost:4173';
const LOOPBACK_ORIGIN = 'http://127.0.0.1:4173';

type StoredPreference = {
  readonly workerId: string;
  readonly accentColor: string | null;
  readonly serverVersion: number;
  readonly syncState: string;
};

function deferredGate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function remotePreference(workerId: string, accentColor: string, serverVersion: number) {
  return {
    shopId: SHOP,
    workerId,
    categoryOrder: [],
    categoryAlignment: 'left',
    productOrder: [],
    accentColor,
    serverVersion,
    updatedAt: `2026-08-29T16:${String(serverVersion).padStart(2, '0')}:00.000Z`,
  };
}

async function readStoredPreference(page: Parameters<typeof test>[0] extends never ? never : any, workerId: string) {
  return page.evaluate(
    async ({ databaseName, key }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<StoredPreference | null>((resolve, reject) => {
          const transaction = database.transaction('workerUiPreferences', 'readonly');
          const request = transaction.objectStore('workerUiPreferences').get(key);
          request.onsuccess = () => resolve((request.result as StoredPreference | undefined) ?? null);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE, key: `${SHOP}:${workerId}` },
  );
}

async function assertRuntimeSentinel(page: Parameters<typeof test>[0] extends never ? never : any, sentinel: string) {
  await expect
    .poll(() =>
      page.evaluate((expected) => {
        const runtime = (window as Window & { __tuxRemoteSentinel?: string }).__tuxRemoteSentinel;
        const shell = document.querySelector<HTMLElement>('.operations-shell');
        return runtime === expected && shell?.dataset['remoteSentinel'] === expected;
      }, sentinel),
    )
    .toBe(true);
}

test('delayed remote worker preferences reconcile through the production subscription without reload', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');

  const configuration = minimalConfiguration();
  const workerAGate = deferredGate();
  const workerBGate = deferredGate();
  let workerARequestCount = 0;
  let workerBRequestCount = 0;
  let workerASeenResolve!: () => void;
  let workerBSeenResolve!: () => void;
  const workerASeen = new Promise<void>((resolve) => {
    workerASeenResolve = resolve;
  });
  const workerBSeen = new Promise<void>((resolve) => {
    workerBSeenResolve = resolve;
  });
  const workerARemote = remotePreference(WORKER, '#1E3A8A', 11);
  let workerBRemote = remotePreference(WORKER_TWO, '#7E22CE', 12);

  await page.route(`${REMOTE_ORIGIN}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === '/api/device-session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ shopId: SHOP, deviceId: '50000000-0000-4000-8000-000000000001' }),
      });
      return;
    }

    if (url.pathname === '/api/operations-config') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 1, bundle: configuration }),
      });
      return;
    }

    if (url.pathname === '/api/worker-ui-preferences' && request.method() === 'GET') {
      const workerId = url.searchParams.get('workerId');
      if (workerId === WORKER) {
        workerARequestCount += 1;
        if (workerARequestCount === 1) {
          workerASeenResolve();
          await workerAGate.promise;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(workerARemote),
        });
        return;
      }
      if (workerId === WORKER_TWO) {
        workerBRequestCount += 1;
        if (workerBRequestCount === 1) {
          workerBSeenResolve();
          await workerBGate.promise;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(workerBRemote),
        });
        return;
      }
    }

    if (url.pathname.startsWith('/api/')) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }

    const target = `${LOOPBACK_ORIGIN}${url.pathname}${url.search}`;
    const response = await route.fetch({ url: target });
    await route.fulfill({ response });
  });

  await enterActiveOrders(page, REMOTE_ORIGIN);
  await setWorkerAppearance(page, 'Demo Worker One', 'Light');
  await workerASeen;

  const initialLocalAccent = await renderedSystemAccent(page);
  const sentinel = await page.evaluate(() => {
    const value = crypto.randomUUID();
    (window as Window & { __tuxRemoteSentinel?: string }).__tuxRemoteSentinel = value;
    document.querySelector<HTMLElement>('.operations-shell')?.setAttribute('data-remote-sentinel', value);
    return value;
  });

  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#7e22ce');
  const unsavedPurpleAccent = await renderedSystemAccent(page);
  expect(unsavedPurpleAccent).not.toBe(initialLocalAccent);

  workerAGate.release();

  await expect
    .poll(() => readStoredPreference(page, WORKER))
    .toMatchObject({
      workerId: WORKER,
      accentColor: '#1E3A8A',
      serverVersion: 11,
      syncState: 'CLEAN',
    });
  await expect(dialog.locator("input[type='color']")).toHaveValue('#7e22ce');
  await expect.poll(() => renderedSystemAccent(page)).toBe(unsavedPurpleAccent);
  await assertRuntimeSentinel(page, sentinel);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const workerABlueRenderedAccent = await renderedSystemAccent(page);
  expect(workerABlueRenderedAccent).not.toBe(initialLocalAccent);
  expect(workerABlueRenderedAccent).not.toBe(unsavedPurpleAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await assertRuntimeSentinel(page, sentinel);

  workerBRemote = remotePreference(WORKER_TWO, '#0F766E', 13);
  const workerBRequestsBeforeNonActiveRetry = workerBRequestCount;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => workerARequestCount).toBeGreaterThan(1);
  expect(workerBRequestCount).toBe(workerBRequestsBeforeNonActiveRetry);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerABlueRenderedAccent);
  await assertRuntimeSentinel(page, sentinel);

  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two');
  await workerBSeen;
  const workerBInitialLocalAccent = await renderedSystemAccent(page);
  const workerBSentinel = await page.evaluate(() => {
    const value = crypto.randomUUID();
    (window as Window & { __tuxRemoteSentinel?: string }).__tuxRemoteSentinel = value;
    document.querySelector<HTMLElement>('.operations-shell')?.setAttribute('data-remote-sentinel', value);
    return value;
  });

  workerBGate.release();

  await expect
    .poll(() => readStoredPreference(page, WORKER_TWO))
    .toMatchObject({
      workerId: WORKER_TWO,
      accentColor: '#0F766E',
      serverVersion: 13,
      syncState: 'CLEAN',
    });
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(workerBInitialLocalAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#0f766e');
  await assertRuntimeSentinel(page, workerBSentinel);

  await page.screenshot({
    path: testInfo.outputPath('delayed-remote-worker-accent-reconciled-without-reload.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
