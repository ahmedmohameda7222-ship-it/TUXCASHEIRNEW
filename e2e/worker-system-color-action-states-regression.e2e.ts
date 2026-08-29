import { expect, test } from '@playwright/test';
import { contrast, paint } from './worker-system-color-assertions';
import {
  enterActiveOrders,
  openSystemColorDialog,
  prepareRenderedOrderControls,
  setNativeSystemColor,
  setWorkerAppearance,
} from './worker-system-color-test-helpers';

const COLOR_MATRIX = [
  '#1f6b52',
  '#1e3a8a',
  '#7e22ce',
  '#dc2626',
  '#facc15',
  '#050505',
  '#fafafa',
] as const;

test('custom action foreground stays readable for normal hover and pressed matrix states', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  await prepareRenderedOrderControls(page);

  for (const appearance of ['Light', 'Dark'] as const) {
    await setWorkerAppearance(page, 'Demo Worker One', appearance);
    for (const color of COLOR_MATRIX) {
      const dialog = await openSystemColorDialog(page, 'Demo Worker One');
      await setNativeSystemColor(dialog, color);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog).toBeHidden();

      const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
      const normal = await paint(placeOrder);
      expect(
        contrast(normal.backgroundColor, normal.color),
        `${appearance} ${color} normal`,
      ).toBeGreaterThanOrEqual(4.5);

      await placeOrder.hover();
      const hovered = await paint(placeOrder);
      expect(
        contrast(hovered.backgroundColor, hovered.color),
        `${appearance} ${color} hover`,
      ).toBeGreaterThanOrEqual(4.5);

      const box = await placeOrder.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      const pressed = await paint(placeOrder);
      expect(
        contrast(pressed.backgroundColor, pressed.color),
        `${appearance} ${color} pressed`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(hovered.backgroundColor).not.toBe(normal.backgroundColor);
      expect(pressed.backgroundColor).not.toBe(hovered.backgroundColor);
      await page.mouse.move(1, 1);
      await page.mouse.up();

      await page.getByRole('button', { name: 'Edit menu' }).click();
      const primary = page.locator('.menu-edit-actions .primary-action');
      const primaryPaint = await paint(primary);
      expect(
        contrast(primaryPaint.backgroundColor, primaryPaint.color),
        `${appearance} ${color} primary`,
      ).toBeGreaterThanOrEqual(4.5);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
});
