import { expect, test, type Locator } from '@playwright/test';
import { contrast, paint, resolvedColor } from './worker-system-color-assertions';
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

async function settledPaint(locator: Locator, background: string, foreground: string) {
  await expect
    .poll(async () => {
      const current = await paint(locator);
      return [current.backgroundColor, current.color];
    })
    .toEqual([background, foreground]);
  return paint(locator);
}

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

      const foreground = await resolvedColor(page, 'var(--tux-action-foreground)');
      const strong = await resolvedColor(page, 'var(--tux-accent-strong)');
      const hover = await resolvedColor(page, 'var(--tux-accent-hover)');
      const pressed = await resolvedColor(page, 'var(--tux-accent-pressed)');
      const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
      const normal = await settledPaint(placeOrder, strong, foreground);
      expect(
        contrast(normal.backgroundColor, normal.color),
        `${appearance} ${color} normal`,
      ).toBeGreaterThanOrEqual(4.5);

      await placeOrder.hover();
      const hovered = await settledPaint(placeOrder, hover, foreground);
      expect(
        contrast(hovered.backgroundColor, hovered.color),
        `${appearance} ${color} hover`,
      ).toBeGreaterThanOrEqual(4.5);

      const box = await placeOrder.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      const active = await settledPaint(placeOrder, pressed, foreground);
      expect(
        contrast(active.backgroundColor, active.color),
        `${appearance} ${color} pressed`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(hovered.backgroundColor).not.toBe(normal.backgroundColor);
      expect(active.backgroundColor).not.toBe(hovered.backgroundColor);
      expect(active.backgroundColor).not.toBe(normal.backgroundColor);
      await page.mouse.move(1, 1);
      await page.mouse.up();

      await page.getByRole('button', { name: 'Edit menu' }).click();
      const primary = page.locator('.menu-edit-actions .primary-action');
      const primaryPaint = await settledPaint(primary, strong, foreground);
      expect(
        contrast(primaryPaint.backgroundColor, primaryPaint.color),
        `${appearance} ${color} primary`,
      ).toBeGreaterThanOrEqual(4.5);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
});
