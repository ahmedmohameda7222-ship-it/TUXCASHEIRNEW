import { mkdirSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

// Mock-authenticated browser evidence only. Never use this for hosted Owner UAT.
export const PREMIUM_EVIDENCE_VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-375', width: 375, height: 844 },
  { name: 'phone-320', width: 320, height: 720 },
] as const;

/** Owner-approved eight-tab responsive review widths. This is mock-auth evidence only. */
export const EIGHT_TABS_EVIDENCE_VIEWPORTS = [
  { name: 'orders-reference-1536', width: 1536, height: 960 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'tablet-1024', width: 1024, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-360', width: 360, height: 800 },
] as const;

export function premiumVisualViewports<T extends { width: number; height: number; name?: string }>(
  defaults: readonly T[],
) {
  if (process.env['TUX_ADMIN_EIGHT_TABS_CAPTURE'] === '1')
    return EIGHT_TABS_EVIDENCE_VIEWPORTS;
  return process.env['P04_P07_CAPTURE'] === '1' ? PREMIUM_EVIDENCE_VIEWPORTS : defaults;
}

export async function capturePremiumScreenshot(page: Page, scene: string): Promise<void> {
  if (
    process.env['P04_P07_CAPTURE'] !== '1' &&
    process.env['TUX_ADMIN_EIGHT_TABS_CAPTURE'] !== '1'
  )
    return;
  mkdirSync('artifacts/p04-p07', { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Chromium viewport unavailable');
  await page.screenshot({
    path: `artifacts/p04-p07/${scene}-${viewport.width}x${viewport.height}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

/**
 * Final targeted acceptance evidence, separate from the immutable 162-scene
 * six-width baseline. Captures are mock-authenticated and contain no real data.
 */
export async function captureTargetedAcceptance(
  page: Page,
  wave: 'p04' | 'p05' | 'p06' | 'p07',
  scene: string,
  theme: 'light' | 'dark',
  entry: 'cold' | 'warm',
): Promise<void> {
  if (process.env['P04_P07_TARGETED_CAPTURE'] !== '1') return;
  mkdirSync('artifacts/p04-p07-targeted', { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('No Chromium viewport');
  await page.screenshot({
    path: `artifacts/p04-p07-targeted/${wave}-${scene}-${theme}-${entry}-${viewport.width}x${viewport.height}.png`,
    animations: 'disabled',
    fullPage: true,
  });
}

function channelLuminance(c: number) {
  const value = c / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function rgbLuminance(color: string): number {
  const expanded = color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, '#$1$1$2$2$3$3');
  const hex = /^#([0-9a-f]{6})$/i.exec(expanded.trim());
  const channels = hex
    ? [0, 2, 4].map((index) => Number.parseInt(hex[1]!.slice(index, index + 2), 16))
    : color
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unexpected CSS color: ${color}`);
  return (
    0.2126 * channelLuminance(channels[0]!) +
    0.7152 * channelLuminance(channels[1]!) +
    0.0722 * channelLuminance(channels[2]!)
  );
}

function contrastRatio(first: string, second: string): number {
  const a = rgbLuminance(first),
    b = rgbLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export async function verifyTargetedVisualLayout(
  page: Page,
  target: {
    route: string;
    heading: string;
    theme: 'light' | 'dark';
    entry: 'cold' | 'warm';
  },
): Promise<void> {
  await page.emulateMedia({ colorScheme: target.theme });
  // Force CSS theme on direct navigation too, without touching local storage.
  await page.addInitScript((theme) => {
    document.documentElement.dataset.theme = theme;
  }, target.theme);
  if (target.entry === 'cold') {
    await page.goto(target.route);
  } else {
    await page.goto('/');
    await expect(page.locator('.admin-shell')).toBeVisible();
    // SPA transition retains lazy-loaded styles from the previously visited route.
    await page.evaluate((route) => {
      window.history.pushState({}, '', route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, target.route);
  }
  await expect(
    page.getByRole('heading', { name: target.heading, exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator('.admin-page').first()).toBeVisible();

  const computed = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const status = document.querySelector('.admin-order-row__status, .admin-state strong');
    const statusStyle = status ? getComputedStyle(status) : null;
    const onScreenControl = Array.from(document.querySelectorAll('button, input, select'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.top < window.innerHeight &&
          bounds.bottom > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      })
      .find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < -2 || bounds.right > innerWidth + 2;
      });
    const focused = document.activeElement?.tagName ?? null;
    return {
      scheme: root.colorScheme,
      canvas: body.backgroundColor,
      text: root.color,
      secondary: root.getPropertyValue('--tux-text-secondary').trim(),
      surface: root.getPropertyValue('--tux-surface-panel').trim(),
      overflow: document.documentElement.scrollWidth - innerWidth,
      clippedControl: onScreenControl?.outerHTML.slice(0, 180) ?? null,
      statusColor: statusStyle?.color ?? null,
      focused,
    };
  });
  expect(computed.scheme).toContain(target.theme);
  expect(computed.canvas).not.toBe('rgba(0, 0, 0, 0)');
  expect(computed.overflow).toBeLessThanOrEqual(1);
  expect(computed.clippedControl).toBeNull();
  expect(contrastRatio(computed.text, computed.canvas)).toBeGreaterThanOrEqual(7);
  expect(contrastRatio(computed.secondary, computed.canvas)).toBeGreaterThanOrEqual(4.5);
  if (computed.statusColor) {
    expect(contrastRatio(computed.statusColor, computed.surface)).toBeGreaterThanOrEqual(4.5);
  }

  await page.keyboard.press('Tab');
  await expect(page.locator(':focus-visible').first()).toBeVisible();
  // A first tab from the document must reach a keyboard-operated control.
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(['A', 'BUTTON', 'INPUT', 'SELECT', 'SUMMARY']).toContain(focusedTag);
}
