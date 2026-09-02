import { pbkdf2Sync } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import {
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

const REMOTE_ORIGIN = 'https://tux.localhost:4173';
const LOOPBACK_ORIGIN = 'http://127.0.0.1:4173';
const RUNTIME_SENTINEL = 'remote-preference-runtime-sentinel';

type DeferredGate = {
  readonly promise: Promise<void>;
  readonly release: () => void;
};

function deferredGate(): DeferredGate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function workerPinHash(pin: string): string {
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const digest = pbkdf2Sync(pin, salt, 210_000, 32, 'sha256');
  return `pbkdf2-sha256$210000$${salt.toString('hex')}$${digest.toString('hex')}`;
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
    updatedAt: '2026-08-29T16:30:00.000Z',
  };
}

async function markRuntimeSentinel(page: Page): Promise<void> {
  await page.locator('.operations-shell').evaluate((node, sentinel) => {
    (node as HTMLElement & { __remotePreferenceSentinel?: string }).__remotePreferenceSentinel =
      sentinel;
  }, RUNTIME_SENTINEL);
}

async function expectRuntimeSentinel(page: Page): Promise<void> {
  const sentinel = await page.locator('.operations-shell').evaluate((node) => {
    return (node as HTMLElement & { __remotePreferenceSentinel?: string })
      .__remotePreferenceSentinel;
  });
  expect(sentinel).toBe(RUNTIME_SENTINEL);
}

async function triggerProductionPreferenceRetry(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
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
        body: JSON.stringify({
          shopId: SHOP,
          deviceId: '50000000-0000-4000-8000-000000000001',
        }),
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

    if (url.pathname === '/api/worker-auth' && request.method() === 'POST') {
      const body = request.postDataJSON() as { pin?: unknown };
      const pin = typeof body.pin === 'string' ? body.pin : '';
      const worker =
        pin === '1234'
          ? {
              id: WORKER,
              shopId: SHOP,
              displayName: 'Demo Worker One',
              pinHash: workerPinHash(pin),
              active: true,
            }
          : pin === '5678'
            ? {
                id: WORKER_TWO,
                shopId: SHOP,
                displayName: 'Demo Worker Two',
                pinHash: workerPinHash(pin),
                active: true,
              }
            : null;
      await route.fulfill({
        status: worker === null ? 401 : 200,
        contentType: 'application/json',
        body: JSON.stringify(worker === null ? { error: 'invalid_pin' } : { worker }),
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
  await triggerProductionPreferenceRetry(page);
  await workerASeen;

  const initialLocalAccent = await renderedSystemAccent(page);
  await markRuntimeSentinel(page);

  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#7e22ce');
  const unsavedPurpleAccent = await renderedSystemAccent(page);
  expect(unsavedPurpleAccent).not.toBe(initialLocalAccent);

  workerAGate.release();

  await expect(dialog.locator("input[type='color']")).toHaveValue('#7e22ce');
  await expect.poll(() => renderedSystemAccent(page)).toBe(unsavedPurpleAccent);
  await expectRuntimeSentinel(page);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const workerABlueRenderedAccent = await renderedSystemAccent(page);
  expect(workerABlueRenderedAccent).not.toBe(initialLocalAccent);
  expect(workerABlueRenderedAccent).not.toBe(unsavedPurpleAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectRuntimeSentinel(page);

  workerBRemote = remotePreference(WORKER_TWO, '#0F766E', 13);
  const workerBRequestsBeforeNonActiveRetry = workerBRequestCount;
  await triggerProductionPreferenceRetry(page);
  await expect.poll(() => workerARequestCount).toBeGreaterThan(1);
  expect(workerBRequestCount).toBe(workerBRequestsBeforeNonActiveRetry);
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerABlueRenderedAccent);
  await expectRuntimeSentinel(page);

  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two');
  await triggerProductionPreferenceRetry(page);
  await workerBSeen;
  const workerBInitialLocalAccent = await renderedSystemAccent(page);
  await markRuntimeSentinel(page);

  workerBGate.release();

  await expect.poll(() => renderedSystemAccent(page)).not.toBe(workerBInitialLocalAccent);
  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#0f766e');
  await expectRuntimeSentinel(page);

  await page.screenshot({
    path: testInfo.outputPath('delayed-remote-worker-accent-reconciled-without-reload.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
