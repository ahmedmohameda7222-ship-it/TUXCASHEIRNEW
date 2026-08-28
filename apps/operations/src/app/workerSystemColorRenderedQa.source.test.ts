import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(new URL('../../../../e2e/operations.e2e.ts', import.meta.url), 'utf8');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved full color dialog', () => {
    expect(e2e).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(e2e).toContain('width: 1366, height: 768');
    expect(e2e).toContain('width: 1280, height: 720');
    expect(e2e).toContain("input[type='color']");
    expect(e2e).toContain("getByLabel('HEX')");
    expect(e2e).toContain("getByLabel('Red')");
    expect(e2e).toContain("getByLabel('Green')");
    expect(e2e).toContain("getByLabel('Blue')");
    expect(e2e).toContain("name: 'Pick from screen', exact: true");
    expect(e2e).toContain("name: 'Reset to TUX default', exact: true");
    expect(e2e).toContain("getByText('Current color', { exact: true })");
    expect(e2e).toContain("input[type='checkbox']");
    expect(e2e).toContain('toHaveCount(0)');
  });

  it('covers synchronized preview/cancel/reset persistence, appearance modes, and two workers', () => {
    expect(e2e).toContain("'#1e3a8a'");
    expect(e2e).toContain("'#7e22ce'");
    expect(e2e).toContain("'#dc2626'");
    expect(e2e).toContain("'#facc15'");
    expect(e2e).toContain("'#050505'");
    expect(e2e).toContain("'#fafafa'");
    expect(e2e).toContain('Switch / Sign in worker');
    expect(e2e).toContain('Enter PIN to Sign In');
    expect(e2e).toContain("name: 'System', exact: true");
    expect(e2e).toContain("colorScheme: 'dark'");
    expect(e2e).toContain("colorScheme: 'light'");
    expect(e2e).toContain("getPropertyValue('--tux-accent')");
  });
});
