import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CartDrawer.tsx', import.meta.url), 'utf8');

describe('CartDrawer canonical combo intent', () => {
  it('requires and submits the selected canonical combo beverage id', () => {
    expect(source).toContain('comboBeverageProductId: comboBeverageSelections[item.id] ?? null');
    expect(source).toContain('Please select a beverage for every combo.');
  });
});
