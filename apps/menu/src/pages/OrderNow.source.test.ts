import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./OrderNow.tsx', import.meta.url), 'utf8');

describe('OrderNow canonical category identity', () => {
  it('resolves Extras by canonical slug and then uses its UUID id', () => {
    expect(source).toContain("section.slug === 'extras'");
    expect(source).not.toContain("const EXTRAS_SECTION_ID = 'extras'");
  });
});
