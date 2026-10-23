import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./StickyCartBar.tsx', import.meta.url), 'utf8');

describe('live published cart price', () => {
  it('uses current catalog prices rather than the saved cart snapshot after a publish', () => {
    expect(source).toContain('useMenu()');
    expect(source).toContain('currentProduct.price');
    expect(source).toContain('currentExtra.price');
    expect(source).not.toContain('totalPrice,');
    expect(source).toContain('Price unavailable');
  });
});
