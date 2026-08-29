import { expect, test } from '@playwright/test';
import {
  enterActiveOrders,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
  setWorkerAppearance,
  switchWorker,
} from './worker-system-color-test-helpers';

test('switching worker discards an open unsaved system-color draft', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');

  await enterActiveOrders(page);
  await setWorkerAppearance(page, 'Demo Worker One', 'Light');

  const defaultRenderedAccent = await renderedSystemAccent(page);

  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  const workerOneSavedBlueAccent = await renderedSystemAccent(page);
  expect(workerOneSavedBlueAccent).not.toBe(defaultRenderedAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await setNativeSystemColor(dialog, '#7e22ce');
  const workerOneUnsavedPurpleAccent = await renderedSystemAccent(page);
  expect(workerOneUnsavedPurpleAccent).not.toBe(workerOneSavedBlueAccent);

  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two', true);

  await expect(dialog).toBeHidden();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultRenderedAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker Two');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1f6b52');
  await expect(dialog.locator("input[type='color']")).not.toHaveValue('#7e22ce');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultRenderedAccent);

  await switchWorker(page, 'Demo Worker Two', '1234', 'Demo Worker One');
  await expect.poll(() => renderedSystemAccent(page)).toBe(workerOneSavedBlueAccent);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await expect(dialog.locator("input[type='color']")).not.toHaveValue('#7e22ce');

  await page.screenshot({
    path: testInfo.outputPath('worker-switch-discarded-unsaved-color-draft.png'),
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
});
