import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gate = readFileSync(new URL('./BrowserBootstrapGate.tsx', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('./sessionClient.ts', import.meta.url), 'utf8');
const cfg = readFileSync(new URL('../../../../playwright.config.ts', import.meta.url), 'utf8');
const pkg = readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../../../../.github/workflows/ci-full.yml', import.meta.url), 'utf8');

describe('Operations browser E2E build safety', () => {
  it('restricts the legacy test fixture to localhost builds', () => {
    expect(gate).toContain("import.meta.env.MODE === 'e2e-browser-fallback'");
    expect(gate).toContain("window.location.hostname === '127.0.0.1'");
    expect(gate).toContain("window.location.hostname === 'localhost'");
    expect(gate).toContain("window.location.hostname.endsWith('.localhost')");
    const session = readFileSync(new URL('./sessionClient.ts', import.meta.url), 'utf8');
    expect(session).toContain("window.location.hostname.endsWith('.localhost')");
    expect(pkg).toContain('--mode e2e-browser-fallback');
  });

  it('uses local PIN and session only in explicit legacy fixture mode', () => {
    expect(sessionSource).toContain("import.meta.env.MODE === 'e2e-browser-fallback'");
    expect(sessionSource).toContain("window.location.hostname === '127.0.0.1'");
    expect(sessionSource).toContain("window.location.hostname === 'localhost'");
    expect(sessionSource).toContain('if (LEGACY_BROWSER_E2E) {');
    expect(sessionSource).toContain('const result = await session.submitPin(pin);');
    expect(sessionSource).toContain('const result = await session.getState();');
  });

  it('requires a separate branch and PIN login test in CI', () => {
    expect(cfg).toContain('const branchLoginSpec = /operations-branch-login');
    expect(cfg).toContain("process.env['TUX_OPERATIONS_BRANCH_E2E'] === '1'");
    expect(ci).toContain('name: Branch + PIN authenticated Chromium E2E');
    expect(ci).toContain('TUX_OPERATIONS_BRANCH_E2E=1');
    expect(ci).toContain('e2e/operations-branch-login.e2e.ts');
    expect(ci).toContain('BRANCH_LOGIN_RESULT');
  });
});
