import { expect, test } from '@playwright/test';
import {
  enterActiveOrders,
  openSystemColorDialog,
  renderedSystemAccent,
  setNativeSystemColor,
} from './worker-system-color-test-helpers';

test('HEX RGB native picker and EyeDropper synchronize without corrupting normal HEX typing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  const originalAccent = await renderedSystemAccent(page);

  await page.evaluate(() => {
    (window as Window & { EyeDropper?: unknown }).EyeDropper = class {
      async open() {
        return { sRGBHex: '#DC2626' };
      }
    };
  });

  let dialog = await openSystemColorDialog(page, 'Demo Worker One');
  const hex = dialog.getByLabel('HEX');
  await hex.clear();
  await hex.pressSequentially('#1E3');
  await expect(hex).toHaveValue('#1E3');
  await expect(dialog.getByLabel('Red')).toHaveValue('17');
  await expect(dialog.getByLabel('Green')).toHaveValue('238');
  await expect(dialog.getByLabel('Blue')).toHaveValue('51');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#11ee33');
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(originalAccent);

  await hex.pressSequentially('A8A');
  await expect(hex).toHaveValue('#1E3A8A');
  await expect(dialog.getByLabel('Red')).toHaveValue('30');
  await expect(dialog.getByLabel('Green')).toHaveValue('58');
  await expect(dialog.getByLabel('Blue')).toHaveValue('138');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#1e3a8a');
  await expect.poll(() => renderedSystemAccent(page)).not.toBe(originalAccent);

  await dialog.getByLabel('Red').fill('126');
  await dialog.getByLabel('Green').fill('34');
  await dialog.getByLabel('Blue').fill('206');
  await expect(hex).toHaveValue('#7E22CE');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#7e22ce');

  await setNativeSystemColor(dialog, '#1e3a8a');
  await expect(hex).toHaveValue('#1E3A8A');
  await expect(dialog.getByLabel('Red')).toHaveValue('30');
  await expect(dialog.getByLabel('Green')).toHaveValue('58');
  await expect(dialog.getByLabel('Blue')).toHaveValue('138');

  await dialog.getByRole('button', { name: 'Pick from screen', exact: true }).click();
  await expect(hex).toHaveValue('#DC2626');
  await expect(dialog.getByLabel('Red')).toHaveValue('220');
  await expect(dialog.getByLabel('Green')).toHaveValue('38');
  await expect(dialog.getByLabel('Blue')).toHaveValue('38');
  await expect(dialog.locator("input[type='color']")).toHaveValue('#dc2626');

  const beforeInvalidHex = await renderedSystemAccent(page);
  await hex.fill('#12');
  await expect.poll(() => renderedSystemAccent(page)).toBe(beforeInvalidHex);
  await expect(dialog.getByText('Enter a valid 3- or 6-digit HEX color.')).toBeVisible();

  await hex.fill('#1E3A8A');
  const beforeInvalidRgb = await renderedSystemAccent(page);
  await dialog.getByLabel('Red').fill('999');
  await expect.poll(() => renderedSystemAccent(page)).toBe(beforeInvalidRgb);

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    delete (window as Window & { EyeDropper?: unknown }).EyeDropper;
  });
  dialog = await openSystemColorDialog(page, 'Demo Worker One');
  await expect(
    dialog.getByRole('button', { name: 'Pick from screen', exact: true }),
  ).toBeDisabled();
});
