import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

// These source-level contracts protect the exact bounded visual fixes in this PR.
describe('Operations UI alignment contracts', () => {
  it('centers Orders Board tabs when they fit and falls back safely when they overflow', () => {
    const source = css('orders-board.css');

    expect(source).toMatch(/\.board-tabs\s*\{[^}]*justify-content:\s*safe center;/s);
    expect(source).not.toMatch(/\.board-tabs\s*\{[^}]*justify-content:\s*flex-start;/s);
  });

  it('keeps the MoneyInput composition canonical in orders.css instead of a late override', () => {
    const source = css('orders.css');
    const correctionSource = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.money-input-wrap\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);[^}]*border:\s*1px solid var\(--tux-border-subtle\);/s,
    );
    expect(source).toMatch(
      /\.money-input-wrap\s*>\s*input\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*var\(--tux-control-height-md\);[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
    );
    expect(source).toMatch(
      /\.money-input-wrap\s*>\s*input:focus-visible\s*\{[^}]*outline:\s*none;/s,
    );
    expect(source).toMatch(
      /\.money-input-wrap:focus-within\s*\{[^}]*border-color:[^;}]+;[^}]*box-shadow:[^;}]+;/s,
    );
    expect(correctionSource).not.toContain('.money-input-wrap');
  });

  it('keeps Add Expense description, amount, and paid-from controls on one visual baseline', () => {
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

  it('keeps Edit Expense description, amount, and paid-from controls on one desktop row', () => {
    const source = css('expenses.css');

    expect(source).toMatch(/\.expense-dialog\s*\{[^}]*width:\s*min\(100%,\s*54rem\);/s);
    expect(source).not.toMatch(
      /\.expense-dialog\s+\.expense-fields\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/s,
    );
    expect(source).not.toContain(
      '.expense-dialog .expense-description-field,\n.expense-dialog .expense-note-field {',
    );
    expect(source).toMatch(
      /\.expense-dialog\s+\.expense-note-field\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s,
    );
  });

  it('keeps the desktop Current Order panel rounded like its neighboring menu card', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.desktop-cart-wrap\s*\{[^}]*border-radius:\s*var\(--tux-radius-lg\);[^}]*overflow:\s*hidden;/s,
    );
  });
});
