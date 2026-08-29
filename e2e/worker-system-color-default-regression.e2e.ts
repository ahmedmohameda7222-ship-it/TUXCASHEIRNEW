import { expect, test } from '@playwright/test';
import { paint, resolvedColor } from './worker-system-color-assertions';
import {
  enterActiveOrders,
  prepareRenderedOrderControls,
  setWorkerAppearance,
} from './worker-system-color-test-helpers';

test('null worker accent preserves canonical TUX computed styles in Light and Dark', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-browser-fallback');
  await enterActiveOrders(page);
  await prepareRenderedOrderControls(page);

  for (const appearance of ['Light', 'Dark'] as const) {
    await setWorkerAppearance(page, 'Demo Worker One', appearance);
    await expect(page.locator('html')).not.toHaveAttribute('data-tux-custom-accent', 'true');

    const accentColor = await resolvedColor(page, 'var(--tux-accent)');
    const soft = await resolvedColor(page, 'var(--tux-accent-soft)');
    const accentText = await resolvedColor(page, 'var(--tux-accent-text)');
    const strong = await resolvedColor(page, 'var(--tux-accent-strong)');
    const actionForeground = await resolvedColor(page, 'var(--tux-action-foreground)');
    const canonicalFocus = await resolvedColor(
      page,
      'color-mix(in srgb, var(--tux-focus-ring) 70%, transparent)',
    );

    const placeOrder = page.getByRole('button', { name: 'Place Order', exact: true });
    const placePaint = await paint(placeOrder);
    expect(placePaint.backgroundColor).toBe(accentColor);
    expect(placePaint.borderColor).toBe(accentColor);
    expect(placePaint.color).toBe(actionForeground);

    for (const locator of [
      page.locator('.operations-header .nav-item-active'),
      page.locator('.menu-toolbar .category-rail button.selected'),
      page.locator('.order-type-section .segmented-control button.selected'),
      page.locator('.payment-methods button.selected'),
    ]) {
      const selected = await paint(locator);
      expect(selected.backgroundColor).toBe(soft);
      expect(selected.color).toBe(accentText);
    }

    const operator = page.getByRole('button', { name: /Demo Worker One/ });
    await operator.click();
    const appearancePaint = await paint(page.locator('.operator-menu .appearance-option-active'));
    expect(appearancePaint.backgroundColor).toBe(soft);
    expect(appearancePaint.color).toBe(strong);
    await operator.click();

    await page.keyboard.press('Tab');
    await placeOrder.focus();
    await expect(placeOrder).toBeFocused();
    const focused = await paint(placeOrder);
    expect(focused.outlineWidth).toBe('3px');
    expect(focused.outlineColor).toBe(canonicalFocus);
  }
});
