import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(new URL('../../../../e2e/operations.e2e.ts', import.meta.url), 'utf8');
const source = e2e.replace(/\s+/g, ' ');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved full color dialog', () => {
    expect(source).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(source).toContain('width: 1366, height: 768');
    expect(source).toContain('width: 1280, height: 720');
    expect(source).toContain("input[type='color']");
    expect(source).toContain("getByLabel('HEX')");
    expect(source).toContain("getByLabel('Red')");
    expect(source).toContain("getByLabel('Green')");
    expect(source).toContain("getByLabel('Blue')");
    expect(source).toContain("name: 'Pick from screen', exact: true");
    expect(source).toContain("name: 'Reset to TUX default', exact: true");
    expect(source).toContain("getByText('Current color', { exact: true })");
    expect(source).toContain("input[type='checkbox']");
    expect(source).toContain('toHaveCount(0)');
  });

  it('covers synchronized preview/cancel/reset persistence, appearance modes, and two workers', () => {
    expect(source).toContain("'#1e3a8a'");
    expect(source).toContain("'#7e22ce'");
    expect(source).toContain("'#dc2626'");
    expect(source).toContain("'#facc15'");
    expect(source).toContain("'#050505'");
    expect(source).toContain("'#fafafa'");
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
    expect(source).toContain("'system-color-picker-mobile.png'");
  });
});
