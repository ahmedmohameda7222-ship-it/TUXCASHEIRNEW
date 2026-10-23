import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const FINAL_VISUAL_ROOT = join('artifacts', 'tux-final');

export const FINAL_VISUAL_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 375, height: 844 },
  { width: 320, height: 720 },
] as const;

export const FINAL_VISUAL_SCENES = [
  'alerts-list',
  'alerts-filters',
  'alerts-empty',
  'alerts-source-error',
  'alerts-restricted',
  'health-overview',
  'health-unknown',
  'health-stale',
  'devices-list',
  'device-detail',
  'device-revoked',
  'printers-unavailable',
  'checklist-open',
  'checklist-close',
  'manager-log',
  'whatsapp-overview',
  'whatsapp-not-configured',
  'whatsapp-conversation',
  'whatsapp-quick-replies',
  'whatsapp-rule-disabled',
] as const;

export const FINAL_PARITY_SCENES = [
  'alerts-list',
  'alerts-empty',
  'devices-list',
  'health-stale',
  'whatsapp-overview',
  'whatsapp-not-configured',
  'whatsapp-conversation',
  'whatsapp-rule-disabled',
] as const;

export type FinalVisualScene = (typeof FINAL_VISUAL_SCENES)[number];
export type FinalParityScene = (typeof FINAL_PARITY_SCENES)[number];
export type FinalVisualTheme = 'light' | 'dark';
export type FinalVisualEntry = 'cold' | 'warm';

function screenshotPath(
  matrix: 'matrix' | 'parity',
  scene: string,
  width: number,
  height: number,
  theme: FinalVisualTheme,
  entry: FinalVisualEntry,
) {
  const directory = join(FINAL_VISUAL_ROOT, matrix);
  mkdirSync(directory, { recursive: true });
  return join(directory, `${scene}__${width}x${height}__${theme}__${entry}.png`);
}

export async function prepareFinalVisualPage(
  page: Page,
  viewport: { width: number; height: number },
  theme: FinalVisualTheme,
) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
}

export async function assertFinalVisualUsability(page: Page) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}',
  });
  await expect(page.locator('main')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const interactive = page
    .locator(
      'main button:not([disabled]), main a[href], main input:not([disabled]), main select:not([disabled])',
    )
    .first();
  if ((await interactive.count()) > 0 && (await interactive.isVisible())) {
    await interactive.focus();
    await expect(interactive).toBeFocused();
  }

  const contrast = await page.evaluate(() => {
    const parse = (value: string) => {
      const parts = value
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
      return parts?.length === 3 ? parts : null;
    };
    const luminance = (rgb: number[]) => {
      const channels = rgb.map((value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
    };
    const styles = getComputedStyle(document.body);
    const foreground = parse(styles.color);
    const background = parse(styles.backgroundColor);
    if (foreground === null || background === null) return null;
    const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (lighter! + 0.05) / (darker! + 0.05);
  });
  expect(contrast).not.toBeNull();
  expect(contrast ?? 0).toBeGreaterThanOrEqual(3);
}

export async function captureFinalMatrixScene(
  page: Page,
  scene: FinalVisualScene,
  viewport: { width: number; height: number },
) {
  await assertFinalVisualUsability(page);
  await page.screenshot({
    path: screenshotPath('matrix', scene, viewport.width, viewport.height, 'light', 'cold'),
    fullPage: true,
    animations: 'disabled',
  });
}

export async function finalStyleFingerprint(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return [
        style.display,
        style.position,
        style.borderRadius,
        style.padding,
        style.color,
        style.backgroundColor,
        style.fontSize,
      ].join('|');
    });
}

export async function captureFinalParityScene(
  page: Page,
  scene: FinalParityScene,
  viewport: { width: number; height: number },
  theme: FinalVisualTheme,
  entry: FinalVisualEntry,
) {
  await assertFinalVisualUsability(page);
  await page.screenshot({
    path: screenshotPath('parity', scene, viewport.width, viewport.height, theme, entry),
    fullPage: true,
    animations: 'disabled',
  });
}
