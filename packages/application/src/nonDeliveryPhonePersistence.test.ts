import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersSource = readFileSync(new URL('./orders.ts', import.meta.url), 'utf8');
const modelsSource = readFileSync(new URL('../../domain/src/models.ts', import.meta.url), 'utf8');
const syncSource = readFileSync(
  new URL('../../domain/src/syncContract.ts', import.meta.url),
  'utf8',
);

describe('required non-delivery customer phone persistence', () => {
  it('keeps validated pickup/take-away phone authority in the immutable fulfillment snapshot', () => {
    expect(modelsSource).toContain('readonly customerPhone:');
    expect(ordersSource).toContain('customerPhone:');
    expect(ordersSource).toContain('normalizedPhone: input.normalizedDeliveryPhone');
    expect(syncSource).toContain("source['customerPhone']");
  });
});
