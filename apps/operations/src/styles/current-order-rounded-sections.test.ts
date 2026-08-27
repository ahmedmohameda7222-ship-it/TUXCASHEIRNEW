import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

describe('Current Order rounded section cards', () => {
  it('spaces the scrollable Current Order sections on the canvas surface', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /\.cart-scroll\s*\{[^}]*display:\s*grid;[^}]*align-content:\s*start;[^}]*gap:\s*var\(--tux-space-2\);[^}]*padding:\s*var\(--tux-space-2\);[^}]*background:\s*var\(--tux-surface-canvas\);/s,
    );
  });

  it('renders each top-level cart section as a rounded bordered card without a shadow', () => {
    const source = css('final-pos-corrections.css');
    const match = source.match(/\.cart-section\s*\{([^}]*)\}/s);

    expect(match).not.toBeNull();
    const block = match?.[1] ?? '';
    expect(block).toMatch(/border:\s*1px solid var\(--tux-border-subtle\);/);
    expect(block).toMatch(/border-radius:\s*var\(--tux-radius-lg\);/);
    expect(block).toMatch(/background:\s*var\(--tux-surface-panel\);/);
    expect(block).not.toMatch(/box-shadow:/);
  });

  it('keeps the mobile checkout clearance after adding card gutters', () => {
    const source = css('final-pos-corrections.css');

    expect(source).toMatch(
      /@media \(max-width:\s*54rem\)[\s\S]*?\.mobile-cart-overlay \.cart-scroll\s*\{[^}]*padding-bottom:\s*16px;/,
    );
  });
});
