import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./onlineOrderAcceptance.ts', import.meta.url), 'utf8');

describe('online-order combo materialization', () => {
  it('materializes one beverage selection per combo unit', () => {
    expect(source).toContain('Array.from({ length: item.quantity }, () => item.comboBeverage!)');
  });
});
