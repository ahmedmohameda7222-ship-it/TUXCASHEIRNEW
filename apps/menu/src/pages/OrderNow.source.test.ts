import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OrderNow.tsx', import.meta.url), 'utf8');

describe('OrderNow canonical category and extra identity', () => {
  it('keeps Extras category presentation-only and authorizes extras per product', () => {
    expect(source).toContain("section.slug === 'extras'");
    expect(source).not.toContain("const EXTRAS_SECTION_ID = 'extras'");
    expect(source).toContain('extrasByProduct[product.id]');
    expect(source).not.toContain('extras={extraProducts}');
  });
});
