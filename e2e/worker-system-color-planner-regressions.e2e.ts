import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  enterActiveOrders,
  openSystemColorDialog,
  prepareRenderedOrderControls,
  renderedSystemAccent,
  setNativeSystemColor,
  setWorkerAppearance,
  switchWorker,
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

interface Paint {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly color: string;
  readonly outlineColor: string;
  readonly outlineWidth: string;
}

async function paint(locator: Locator): Promise<Paint> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
    };
  });
}

async function resolvedColor(page: Page, expression: string): Promise<string> {
  return page.evaluate((value) => {
    const node = document.createElement('span');
    node.style.color = value;
    document.body.append(node);
    const color = getComputedStyle(node).color;
    node.remove();
    return color;
  }, expression);
}

function rgb(value: string): readonly [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) throw new Error(`Unsupported computed color ${value}`);
  return [channels[0]!, channels[1]!, channels[2]!];
}

function luminance(value: string): number {
  const [r, g, b] = rgb(value).map((channel) => {
    const next = channel / 255;
    return next <= 0.04045 ? next / 12.92 : ((next + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(left: string, right: string): number {
  const leftLuminance = luminance(left);
  const rightLuminance = luminance(right);
  return (
    (Math.max(leftLuminance, rightLuminance) + 0.05) /
    (Math.min(leftLuminance, rightLuminance) + 0.05)
  );
}

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

    await placeOrder.focus();
    const focused = await paint(placeOrder);
    expect(focused.outlineWidth).toBe('3px');
    expect(focused.outlineColor).toBe(canonicalFocus);
  }
});

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
  await hex.pressSequentially('#1E3A8A');
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
