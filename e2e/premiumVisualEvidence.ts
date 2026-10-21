import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';

// Mock-authenticated browser evidence only. Never use this for hosted Owner UAT.
export const PREMIUM_EVIDENCE_VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-375', width: 375, height: 844 },
  { name: 'phone-320', width: 320, height: 720 },
] as const;

export function premiumVisualViewports<T extends { width: number; height: number; name?: string }>(
  defaults: readonly T[],
) {
  return process.env['P04_P07_CAPTURE'] === '1' ? PREMIUM_EVIDENCE_VIEWPORTS : defaults;
}

export async function capturePremiumScreenshot(page: Page, scene: string): Promise<void> {
  if (process.env['P04_P07_CAPTURE'] !== '1') return;
  mkdirSync('artifacts/p04-p07', { recursive: true });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Chromium viewport unavailable');
  await page.screenshot({
    path: `artifacts/p04-p07/${scene}-${viewport.width}x${viewport.height}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}
