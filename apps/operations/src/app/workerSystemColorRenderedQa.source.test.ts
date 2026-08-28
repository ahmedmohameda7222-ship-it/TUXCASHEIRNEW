import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const e2e = readFileSync(new URL('../../../../e2e/operations.e2e.ts', import.meta.url), 'utf8');

describe('worker system color rendered QA contract', () => {
  it('covers exact desktop viewports and the approved two-row dialog', () => {
    expect(e2e).toContain("test('worker system color is isolated, persistent, and responsive'");
    expect(e2e).toContain('width: 1366, height: 768');
    expect(e2e).toContain('width: 1280, height: 720');
    expect(e2e).toContain("input[type='color']");
    expect(e2e).toContain("input[type='checkbox']");
    expect(e2e).toContain("input[type='text']");
    expect(e2e).toContain('System Color');
    expect(e2e).toContain('Default');
  });

  it('covers preview/cancel/default persistence, appearance modes, and two workers', () => {
    expect(e2e).toContain("'#1e3a8a'");
    expect(e2e).toContain("'#7e22ce'");
    expect(e2e).toContain('Switch / Sign in worker');
    expect(e2e).toContain('Enter PIN to Sign In');
    expect(e2e).toContain("name: 'System', exact: true");
    expect(e2e).toContain("colorScheme: 'dark'");
    expect(e2e).toContain("colorScheme: 'light'");
    expect(e2e).toContain("getPropertyValue('--tux-accent')");
  });
});
