import { expect, test } from '@playwright/test';
import {
  enterActiveOrders,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
  switchWorker,
} from './worker-system-color-test-helpers';

test('worker change closes and discards the previous worker color transaction', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);

  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const savedBlue = await renderedSystemAccent(page);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#7e22ce');
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(savedBlue);
  await switchWorker(page, 'Demo Worker One', '5678', 'Demo Worker Two', true);
  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-tux-custom-accent', 'true');

  await switchWorker(page, 'Demo Worker Two', '1234', 'Demo Worker One');
  await expect.poll(() => renderedSystemAccent(page)).toBe(savedBlue);
});
