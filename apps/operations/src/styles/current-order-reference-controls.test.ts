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
      /import\s*\{[\s\S]*?EditPencilIcon,[\s\S]*?MessageIcon,[\s\S]*?PlusCircleIcon,[\s\S]*?TagIcon[\s\S]*?\}\s*from '\.\/icons';/,
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

  it('renders Cash, Instapay, and Split payment as three separate compact cards without icons', () => {
    const cart = app('OrdersCart.tsx');
    const source = css('final-pos-corrections.css');

    expect(cart).toMatch(
      /className="payment-methods payment-methods-inline"[\s\S]*?methods\.map[\s\S]*?className="split-payment-action"[\s\S]*?Split payment[\s\S]*?<\/div>/,
    );
    expect(cart).not.toMatch(/payment-methods-inline[\s\S]*?<[^>]+Icon/);
    expect(source).toMatch(
      /\.payment-methods-inline\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*4px;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    expect(source).toMatch(
      /\.payment-section \.payment-methods-inline > button\s*\{[^}]*min-height:\s*44px;[^}]*border:\s*1px solid var\(--tux-border-subtle\);[^}]*border-radius:\s*var\(--tux-radius-sm\);[^}]*background:\s*var\(--tux-surface-panel\);[^}]*font-size:\s*14px;/s,
    );
    expect(source).toMatch(
      /\.payment-section \.payment-methods-inline > button\.selected\s*\{[^}]*background:\s*var\(--tux-accent-soft\);/s,
    );
  });

  it('renders compact item actions as one segmented stepper plus smaller Edit and Extra controls', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.line-quantity-stepper\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*40px 2\.25rem 40px;[^}]*border:\s*1px solid var\(--tux-border-subtle\);[^}]*border-radius:\s*var\(--tux-radius-sm\);[^}]*overflow:\s*hidden;/s,
    );
    expect(source).toMatch(
      /\.line-quantity-stepper button\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;[^}]*min-height:\s*40px;/s,
    );
    expect(source).toMatch(
      /\.line-actions > button\s*\{[^}]*min-height:\s*40px;[^}]*padding:\s*0 10px;[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;/s,
    );
    expect(source).toMatch(
      /\.line-quantity-stepper \.quantity-increment\s*\{[^}]*background:\s*var\(--tux-accent-strong\);[^}]*color:\s*var\(--tux-action-foreground\);/s,
    );
  });

  it('keeps Place Order compact and amount-aligned', () => {
    const source = css('premium.css');

    expect(source).toMatch(
      /\.place-order-action\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*3rem;[^}]*justify-content:\s*space-between;[^}]*border-radius:\s*var\(--tux-radius-md\);/s,
    );
  });
});
