import { expect, test } from '@playwright/test';
import {
  enterActiveOrders,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
} from './worker-system-color-test-helpers';

test('backdrop dismissal restores saved or default draft and saving blocks dismissal', async ({
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
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect.poll(() => renderedSystemAccent(page)).toBe(savedBlue);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await dialog.getByRole('button', { name: 'Reset to TUX default', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const defaultAccent = await renderedSystemAccent(page);

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#7e22ce');
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeHidden();
  await expect.poll(() => renderedSystemAccent(page)).toBe(defaultAccent);

  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    const windowWithHooks = window as Window & {
      __releasePreferencePut?: () => void;
      __restorePreferencePut?: () => void;
    };
    windowWithHooks.__restorePreferencePut = () => {
      IDBObjectStore.prototype.put = originalPut;
    };
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      const accentColor =
        typeof value === 'object' && value !== null && 'accentColor' in value
          ? (value as { accentColor?: unknown }).accentColor
          : undefined;
      if (accentColor === '#1E3A8A') {
        let success: EventListener | null = null;
        const fake = {
          result: undefined,
          error: null,
          addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
            if (type !== 'success') return;
            success =
              typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
          },
        } as unknown as IDBRequest<IDBValidKey>;
        windowWithHooks.__releasePreferencePut = () => success?.(new Event('success'));
        return fake;
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    };
  });

  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await setNativeSystemColor(dialog, '#1e3a8a');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
  await page.locator('.system-color-dialog-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __releasePreferencePut?: () => void }).__releasePreferencePut?.();
  });
  await expect(dialog).toBeHidden();
  await page.evaluate(() => {
    (window as Window & { __restorePreferencePut?: () => void }).__restorePreferencePut?.();
  });
});
