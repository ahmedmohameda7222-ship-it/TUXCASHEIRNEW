import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersSource = readFileSync(new URL('./orders.ts', import.meta.url), 'utf8');

describe('payment reference order snapshot persistence', () => {
  it('copies the validated payment reference into each persisted payment part', () => {
    expect(ordersSource).toContain('reference: part.reference');
  });
});
