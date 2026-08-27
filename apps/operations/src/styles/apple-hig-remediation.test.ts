import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(stylesDirectory, '..', 'app');

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

function app(name: string): string {
  return readFileSync(resolve(appDirectory, name), 'utf8');
}

describe('Apple/HIG remediation contracts', () => {
  it('uses explicit semantic hooks for both quantity directions', () => {
    const productCard = app('MenuProductCard.tsx');
    const ordersCart = app('OrdersCart.tsx');

    for (const source of [productCard, ordersCart]) {
      expect(source).toContain('className="quantity-decrement"');
      expect(source).toContain('className="quantity-increment"');
    }
  });

  it('makes cashier-critical labels semibold without making the whole control system heavy', () => {
    const source = css('premium.css');

    expect(source).toMatch(
      /\.order-type-section \.segmented-control button,\s*\.payment-section \.payment-methods button,\s*\.split-payment-action\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
    expect(source).toMatch(
      /\.line-actions button\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
    expect(source).toMatch(
      /\.product-extra-action\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
  });
});
