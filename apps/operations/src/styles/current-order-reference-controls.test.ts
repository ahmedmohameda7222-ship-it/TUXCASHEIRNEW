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

describe('Current Order approved reference controls', () => {
  it('renders Notes & discount as two icon-led actions in one row', () => {
    const cart = app('OrdersCart.tsx');
    const icons = app('icons.tsx');
    const source = css('final-pos-corrections.css');

    expect(cart).toMatch(
      /import\s*\{[\s\S]*?EditPencilIcon,[\s\S]*?MessageIcon,[\s\S]*?PlusCircleIcon,[\s\S]*?TagIcon,[\s\S]*?\}\s*from '\.\/icons';/,
    );
    expect(cart).toMatch(
      /className="adjustment-actions"[\s\S]*?<MessageIcon[^>]*data-icon="message"[\s\S]*?Add note[\s\S]*?<TagIcon[^>]*data-icon="tag"[\s\S]*?Add discount/,
    );
    expect(icons).toContain('export function MessageIcon');
    expect(icons).toContain('export function TagIcon');
    expect(source).toMatch(
      /\.adjustment-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*var\(--tux-space-2\);/s,
    );
    expect(source).toMatch(
      /\.adjustment-disclosure\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*var\(--tux-touch-target\);[^}]*border:\s*1px solid var\(--tux-border-subtle\);[^}]*border-radius:\s*var\(--tux-radius-sm\);/s,
    );
  });

  it('keeps Cash, Instapay, and Split payment in the same equal-width payment row', () => {
    const cart = app('OrdersCart.tsx');
    const source = css('final-pos-corrections.css');

    expect(cart).toMatch(
      /className="payment-methods payment-methods-inline"[\s\S]*?methods\.map[\s\S]*?className="split-payment-action"[\s\S]*?Split payment[\s\S]*?<\/div>/,
    );
    expect(source).toMatch(
      /\.payment-methods-inline\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s,
    );
    expect(source).toMatch(
      /\.payment-methods-inline \.split-payment-action\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*var\(--tux-touch-target\);/s,
    );
  });

  it('renders quantity as one segmented minus-number-plus control with a green increment', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.line-quantity-stepper\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*var\(--tux-touch-target\) 2\.4rem var\(--tux-touch-target\);[^}]*border:\s*1px solid var\(--tux-border-subtle\);[^}]*border-radius:\s*var\(--tux-radius-sm\);[^}]*overflow:\s*hidden;/s,
    );
    expect(source).toMatch(
      /\.line-quantity-stepper output\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*border-inline:\s*1px solid var\(--tux-border-subtle\);/s,
    );
    expect(source).toMatch(
      /\.product-quantity \.quantity-increment,\s*\.line-quantity-stepper \.quantity-increment\s*\{[^}]*background:\s*var\(--tux-accent-strong\);[^}]*color:\s*var\(--tux-action-foreground\);/s,
    );
  });
});
