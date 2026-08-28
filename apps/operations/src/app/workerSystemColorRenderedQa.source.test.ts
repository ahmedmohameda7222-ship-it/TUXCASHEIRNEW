import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(new URL('../../../../e2e/worker-system-color.e2e.ts', import.meta.url), 'utf8');
const source = e2e.replace(/\s+/g, ' ');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved two-row native dialog', () => {
    expect(source).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(source).toContain('width: 1366, height: 768');
    expect(source).toContain('width: 1280, height: 720');
    expect(source).toContain("input[type='color']");
    expect(source).toContain("input[type='checkbox']");
    expect(source).toContain("input[type='text']");
    expect(source).toContain("input[type='number']");
    expect(source).toContain("locator('.system-color-row')");
    expect(source).toContain('toHaveCount(2)');
    expect(source).toContain('toHaveCount(0)');
    expect(source).toContain("getByText('System Color', { exact: true })");
    expect(source).toContain("getByText('Default', { exact: true })");
  });

  it('covers preview/cancel/default persistence, appearance modes, and two workers', () => {
    expect(source).toContain("'#1e3a8a'");
    expect(source).toContain("'#7e22ce'");
    expect(source).toContain('Switch / Sign in worker');
    expect(source).toContain('Enter PIN to Sign In');
    expect(source).toContain("name: 'System', exact: true");
    expect(source).toContain("colorScheme: 'dark'");
    expect(source).toContain("colorScheme: 'light'");
    expect(source).toContain("getPropertyValue('--tux-accent')");
  });

  it('covers action contrast, tablet/mobile usability, and approval evidence', () => {
    expect(source).toContain('renderedActionContrast');
    expect(source).toContain('toBeGreaterThanOrEqual(4.5)');
    expect(source).toContain("test('worker system color picker is usable on tablet and mobile'");
    expect(source).toContain("test.skip(testInfo.project.name === 'desktop-browser-fallback')");
    expect(source).toContain("'system-color-light-blue-desktop.png'");
    expect(source).toContain("'system-color-dark-blue-desktop.png'");
    expect(source).toContain("'system-color-picker-tablet.png'");
    expect(source).toContain("'system-color-picker-mobile.png'");
  });
});
