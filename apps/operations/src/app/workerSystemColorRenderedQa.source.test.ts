import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(new URL('../../../../e2e/operations.e2e.ts', import.meta.url), 'utf8');
const normalizedE2e = e2e.replace(/\s+/g, ' ');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved full color dialog', () => {
    expect(normalizedE2e).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(normalizedE2e).toContain('width: 1366, height: 768');
    expect(normalizedE2e).toContain('width: 1280, height: 720');
    expect(normalizedE2e).toContain("input[type='color']");
    expect(normalizedE2e).toContain("getByLabel('HEX')");
    expect(normalizedE2e).toContain("getByLabel('Red')");
    expect(normalizedE2e).toContain("getByLabel('Green')");
    expect(normalizedE2e).toContain("getByLabel('Blue')");
    expect(normalizedE2e).toContain("name: 'Pick from screen', exact: true");
    expect(normalizedE2e).toContain("name: 'Reset to TUX default', exact: true");
    expect(normalizedE2e).toContain("getByText('Current color', { exact: true })");
    expect(normalizedE2e).toContain("input[type='checkbox']");
    expect(normalizedE2e).toContain('toHaveCount(0)');
  });

  it('covers synchronized preview/cancel/reset persistence, appearance modes, and two workers', () => {
    expect(normalizedE2e).toContain("'#1e3a8a'");
    expect(normalizedE2e).toContain("'#7e22ce'");
    expect(normalizedE2e).toContain("'#dc2626'");
    expect(normalizedE2e).toContain("'#facc15'");
    expect(normalizedE2e).toContain("'#050505'");
    expect(normalizedE2e).toContain("'#fafafa'");
    expect(normalizedE2e).toContain('Switch / Sign in worker');
    expect(normalizedE2e).toContain('Enter PIN to Sign In');
    expect(normalizedE2e).toContain("name: 'System', exact: true");
    expect(normalizedE2e).toContain("colorScheme: 'dark'");
    expect(normalizedE2e).toContain("colorScheme: 'light'");
    expect(normalizedE2e).toContain("getPropertyValue('--tux-accent')");
  });
});
