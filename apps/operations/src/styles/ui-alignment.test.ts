import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

describe('Operations UI alignment contracts', () => {
  it('centers Orders Board status tabs on desktop and keeps the mobile rail start-aligned', () => {
    const source = css('orders-board.css');

    expect(source).toMatch(/\.board-tabs\s*\{[^}]*justify-content:\s*center;/s);
    expect(source).toMatch(
      /@media \(max-width: 54rem\)[\s\S]*?\.board-tabs\s*\{[^}]*justify-content:\s*flex-start;/,
    );
  });

  it('treats every money input as one composed EGP control with one focus ring', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.money-input-wrap\s*>\s*input\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(source).toMatch(
      /\.money-input-wrap\s*>\s*input:focus-visible\s*\{[^}]*outline:\s*none;/s,
    );
    expect(source).toMatch(
      /\.money-input-wrap:focus-within\s*\{[^}]*border-color:[^;}]+;[^}]*box-shadow:[^;}]+;/s,
    );
  });

  it('keeps Expense description, amount, and paid-from controls on one visual baseline', () => {
    const source = css('expenses.css');

    expect(source).toContain(
      '.expense-fields > label > input,\n.expense-fields > label > textarea {',
    );
    expect(source).not.toContain('.expense-fields input,\n.expense-fields textarea {');
    expect(source).toMatch(
      /\.expense-fields\s*>\s*\.money-field\s*\{[^}]*gap:\s*var\(--tux-space-2\);/s,
    );
    expect(source).toMatch(
      /\.expense-fields\s*>\s*\.money-field\s*>\s*label\s*\{[^}]*font-size:\s*var\(--tux-font-size-sm\);[^}]*font-weight:\s*700;[^}]*letter-spacing:\s*0;/s,
    );
  });
});
