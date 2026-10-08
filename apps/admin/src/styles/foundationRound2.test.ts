import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

describe('Admin Round 2 shared visual contract', () => {
  it('uses canonical TUX tokens without legacy Admin aliases', () => {
    const tokens = source('packages/ui/src/tokens.css');
    const adminStyles = [
      source('apps/admin/src/styles/index.css'),
      source('apps/admin/src/styles/hardening.css'),
      source('apps/admin/src/approvals/approvals.css'),
      source('apps/admin/src/audit/audit.css'),
      source('apps/admin/src/settings/settings.css'),
      source('apps/admin/src/inventory/inventory.css'),
    ].join('\n');

    expect(tokens).not.toMatch(/--admin-(?:touch-min|radius-card|content-max|nav-blur)/);
    expect(adminStyles).not.toMatch(
      /var\(--admin-(?:touch-min|radius-card|content-max|nav-blur|border|surface)/,
    );
  });

  it('keeps mobile navigation labels readable and tablet navigation labeled', () => {
    const styles = source('apps/admin/src/styles/index.css');

    expect(styles).toMatch(
      /\.admin-mobile-tabs__item\s*\{[^}]*font-size:\s*var\(--tux-font-size-xs\)/s,
    );
    expect(styles).toMatch(
      /@media \(min-width: 768px\)[\s\S]*?grid-template-columns:\s*(?:clamp\([^;]+\)|(?:2\d\d)px) minmax\(0, 1fr\)/,
    );
    expect(styles).not.toMatch(
      /@media \(min-width: 768px\)[\s\S]*?\.admin-sidebar__link span\s*\{\s*display:\s*none;/,
    );
  });

  it('uses vertical phone lists and one inset shared dialog surface', () => {
    const approvals = source('apps/admin/src/approvals/approvals.css');
    const audit = source('apps/admin/src/audit/audit.css');
    const hardening = source('apps/admin/src/styles/hardening.css');

    expect(approvals).not.toMatch(/\.admin-approval-list\s*\{[^}]*overflow-x:\s*auto/s);
    expect(audit).not.toMatch(/\.admin-audit-list\s*\{[^}]*overflow-x:\s*auto/s);
    expect(approvals).not.toMatch(/\.admin-dialog(?:-backdrop)?\s*\{/);
    expect(hardening).toMatch(
      /\.admin-dialog--sheet\s*\{[^}]*width:\s*calc\(100% - [^)]+\)[^}]*border-radius:\s*var\(--tux-radius-lg\)/s,
    );
  });
});
