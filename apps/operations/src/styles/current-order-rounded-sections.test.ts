import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

describe('Current Order approved nested-card treatment', () => {
  it('keeps Current Order as the main rounded surface and nests section cards with 4px spacing', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.desktop-cart-wrap\s*\{[^}]*border-radius:\s*var\(--tux-radius-lg\);[^}]*overflow:\s*hidden;/s,
    );
    expect(source).toMatch(
      /\.cart-scroll\s*\{[^}]*display:\s*grid;[^}]*align-content:\s*start;[^}]*gap:\s*4px;[^}]*padding:\s*4px;[^}]*background:\s*var\(--tux-surface-panel\);/s,
    );
  });

  it('renders each top-level cart section as a rounded bordered card inside the Current Order surface', () => {
    const source = css('final-pos-corrections.css');
    const match = source.match(/\.cart-section\s*\{([^}]*)\}/s);

    expect(match).not.toBeNull();
    const block = match?.[1] ?? '';
    expect(block).toMatch(/border:\s*1px solid var\(--tux-border-subtle\);/);
    expect(block).toMatch(/border-radius:\s*var\(--tux-radius-lg\);/);
    expect(block).toMatch(/background:\s*var\(--tux-surface-panel\);/);
    expect(block).not.toMatch(/box-shadow:/);
  });

  it('treats totals and Place Order as the compact final inner card', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.cart-totals\s*\{[^}]*margin:\s*0 4px 4px;[^}]*border:\s*1px solid var\(--tux-border-subtle\);[^}]*border-radius:\s*var\(--tux-radius-lg\);[^}]*box-shadow:\s*none;/s,
    );
    expect(source).toMatch(
      /\.place-order-action\s*\{[^}]*min-height:\s*3rem;[^}]*justify-content:\s*space-between;/s,
    );
  });

  it('keeps the mobile checkout clearance after tightening the card spacing', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /@media \(max-width:\s*54rem\)[\s\S]*?\.mobile-cart-overlay \.cart-scroll\s*\{[^}]*padding-bottom:\s*16px;/,
    );
  });
});
