import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gate = readFileSync(new URL('./BrowserBootstrapGate.tsx', import.meta.url), 'utf8');
const playwright = readFileSync(new URL('../../../../playwright.config.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};
const rootCi = readFileSync(
  new URL('../../../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

describe('Operations browser fallback and branch login E2E isolation', () => {
  it('uses an explicit localhost-only compile-time browser fixture mode, never production', () => {
    expect(gate).toContain("import.meta.env.MODE === 'e2e-browser-fallback'");
    expect(gate).toContain("window.location.hostname === '127.0.0.1'");
    expect(gate).toContain("window.location.hostname === 'localhost'");
    expect(packageJson.scripts['e2e:serve']).toContain('--mode e2e-browser-fallback');
  });

  it('runs real branch/PIN login separately rather than silently excluding it', () => {
    expect(playwright).toContain("const branchLoginSpec = /operations-branch-login");
    expect(playwright).toContain("process.env['TUX_OPERATIONS_BRANCH_E2E'] === '1'");
    expect(rootCi).toContain('name: Branch + PIN authenticated Chromium E2E');
    expect(rootCi).toContain('TUX_OPERATIONS_BRANCH_E2E=1');
    expect(rootCi).toContain('e2e/operations-branch-login.e2e.ts');
  });
});
