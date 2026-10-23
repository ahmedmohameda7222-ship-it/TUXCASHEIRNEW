import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(new URL('./Home.tsx', import.meta.url), 'utf8');

describe('Menu homepage image performance', () => {
  it('does not use a stale carousel index when a live published catalog removes a bestseller', () => {
    expect(home).toContain('const safeCurrent = current % total;');
    expect(home).not.toContain('bestSellers[current].id');
    expect(home).not.toContain('item={bestSellers[current]}');
  });

  it('defers the below-the-fold heavy TUX Truck photograph', () => {
    expect(home).toMatch(/src=\{truckImg\}[\s\S]*?loading="lazy"[\s\S]*?decoding="async"/);
  });
});
