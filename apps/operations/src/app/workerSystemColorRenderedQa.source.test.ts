import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(
  new URL('../../../../e2e/worker-system-color.e2e.ts', import.meta.url),
  'utf8',
);
const matrixE2e = readFileSync(
  new URL('../../../../e2e/worker-system-color-matrix.e2e.ts', import.meta.url),
  'utf8',
);
const pickerCss = readFileSync(
  new URL('../styles/system-color-picker.css', import.meta.url),
  'utf8',
);
const source = `${e2e}\n${matrixE2e}`.replace(/\s+/g, ' ');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved native dialog', () => {
    expect(source).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(source).toContain('width: 1366, height: 768');
    expect(source).toContain('width: 1280, height: 720');
    expect(source).toContain("input[type='color']");
    expect(source).toContain("input[type='checkbox']");
    expect(source).toContain("input[type='text']");
    expect(source).toContain("input[type='number']");
    expect(source).toContain("getByText('Current color', { exact: true })");
    expect(source).toContain("getByText('Visual picker', { exact: true })");
    expect(source).toContain("name: 'Pick from screen', exact: true");
    expect(source).toContain('toHaveCount(1)');
    expect(source).toContain('toHaveCount(0)');
    expect(source).toContain("name: 'Reset to TUX default', exact: true");
    expect(source).toContain("name: 'Cancel', exact: true");
    expect(source).toContain("name: 'Save', exact: true");
    expect(source).toContain('toBeGreaterThanOrEqual(44)');
    expect(source).toContain("keyboard.press('Shift+Tab')");
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

  it('covers actual action contrast, tablet/mobile usability, and approval evidence', () => {
    expect(source).toContain('computedPaint');
    expect(source).toContain('assertRenderedControls');
    expect(source).toContain("'Place Order text'");
    expect(source).toContain('toBeGreaterThanOrEqual(4.5)');
    expect(source).toContain("test('worker system color picker is usable on tablet and mobile'");
    expect(source).toContain("test.skip(testInfo.project.name === 'desktop-browser-fallback')");
    expect(source).toContain("'system-color-light-blue-desktop.png'");
    expect(source).toContain("'system-color-dark-blue-desktop.png'");
    expect(source).toContain("'system-color-picker-tablet.png'");
    expect(source).toContain("'system-color-picker-mobile.png'");
  });

  it('covers the required rendered robustness matrix in both Light and Dark', () => {
    expect(source).toContain(
      "test('worker system color robustness matrix verifies actual rendered controls in light and dark'",
    );
    expect(source).toContain("'#1f6b52'");
    expect(source).toContain("'#1e3a8a'");
    expect(source).toContain("'#7e22ce'");
    expect(source).toContain("'#dc2626'");
    expect(source).toContain("'#facc15'");
    expect(source).toContain("'#050505'");
    expect(source).toContain("'#fafafa'");
    expect(source).toContain("for (const appearance of ['Light', 'Dark'] as const)");
    expect(source).toContain('assertRenderedControls');
    expect(source).toContain('assertFocusedPicker');
    expect(source).toContain('semanticStatusColors');
    expect(source).toContain('MIN_DESTRUCTIVE_DISTANCE');
  });

  it('uses canonical surface tokens so the dialog remains opaque at compact widths', () => {
    expect(pickerCss).toContain('background: var(--tux-surface-panel);');
    expect(pickerCss).toContain('border: 1px solid var(--tux-border-subtle);');
    expect(pickerCss).toContain('box-shadow: var(--tux-shadow-md);');
    expect(pickerCss).toContain('color: var(--tux-text-primary);');
    expect(pickerCss).not.toContain('var(--tux-panel)');
    expect(pickerCss).not.toContain('var(--tux-border)');
    expect(pickerCss).not.toContain('var(--tux-shadow-lg)');
    expect(pickerCss).not.toContain('var(--tux-text)');
  });
});
