import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('persisted combo checkout authority', () => {
  it('blocks a persisted combo when the current catalog has no eligible beverage left', () => {
    const source = readFileSync(new URL('./CartDrawer.tsx', import.meta.url), 'utf8');

    expect(source).toMatch(
      /comboBeveragesByProduct\s*,\s*products|products\s*,\s*comboBeveragesByProduct/,
    );
    expect(source).toMatch(
      /products\.find\(\(product\)\s*=>\s*product\.id\s*===\s*productId\)/,
    );
    expect(source).toContain('currentProduct?.is_combo');
    expect(source).toContain('options.length === 0');
  });
});
