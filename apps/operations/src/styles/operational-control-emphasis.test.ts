import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

describe('cashier operational control emphasis', () => {
  it('uses bold weight for every order type, payment method, and split payment action', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.order-type-section \.segmented-control button,\s*\.payment-section \.payment-methods button,\s*\.split-payment-action\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*700;/s,
    );
  });

  it('gives the product-card increment a visible action boundary like Current Order increment', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.product-quantity \.quantity-increment\s*\{[^}]*border-left:\s*1px solid var\(--tux-border-subtle\);/s,
    );
  });
});
