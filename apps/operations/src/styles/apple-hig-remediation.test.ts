import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(stylesDirectory, '..', 'app');
const repoRoot = resolve(stylesDirectory, '../../../..');

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

function app(name: string): string {
  return readFileSync(resolve(appDirectory, name), 'utf8');
}

function tokenCss(): string {
  return readFileSync(resolve(repoRoot, 'packages/ui/src/tokens.css'), 'utf8');
}

function rgb(hex: string): readonly [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
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
    const source = css('final-pos-corrections.css');

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

  it('keeps light secondary text at AA contrast for small operational copy', () => {
    expect(contrast('#6d7470', '#f8faf9')).toBeGreaterThanOrEqual(4.5);
    expect(tokenCss()).toContain('--tux-text-secondary: #6d7470;');
  });

  it('separates selected text from pressed-action color in dark mode', () => {
    const tokens = tokenCss();
    const styles = css('final-pos-corrections.css');

    expect(tokens).toContain('--tux-accent-text: #14533f;');
    expect(tokens).toContain('--tux-accent-text: #5fae8a;');
    expect(contrast('#5fae8a', '#173429')).toBeGreaterThanOrEqual(4.5);
    expect(styles).toContain('color: var(--tux-accent-text);');
  });
});
