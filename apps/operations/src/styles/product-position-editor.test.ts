import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function css(): string {
  return readFileSync(
    fileURLToPath(new URL('./final-pos-corrections.css', import.meta.url)),
    'utf8',
  );
}

describe('Product position editor visual contract', () => {
  it('provides a compact management entry and clear reorder state without changing card dimensions', () => {
    const source = css();
    expect(source).toMatch(
      /\.category-manage-order-action\s*\{[^}]*min-height:\s*44px;[^}]*padding:[^;}]*;/s,
    );
    expect(source).toMatch(
      /\.product-card-reordering\s*\{[^}]*cursor:\s*grab;[^}]*transition:[^;}]*;/s,
    );
    expect(source).toMatch(
      /\.product-card-dragging,\s*\.product-card-grabbed\s*\{[^}]*box-shadow:[^;}]*;[^}]*transform:[^;}]*;/s,
    );
  });

  it('keeps move and commit actions accessible and the commit bar sticky', () => {
    const source = css();
    expect(source).toMatch(
      /\.product-reorder-move\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s,
    );
    expect(source).toMatch(
      /\.product-reorder-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s,
    );
  });

  it('removes reorder motion when reduced motion is requested', () => {
    const source = css();
    expect(source).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*\.product-card-reordering[\s\S]*transition:\s*none;/,
    );
  });
});
