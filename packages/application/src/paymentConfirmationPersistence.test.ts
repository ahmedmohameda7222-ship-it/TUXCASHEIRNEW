import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersSource = readFileSync(new URL('./orders.ts', import.meta.url), 'utf8');
const modelsSource = readFileSync(new URL('../../domain/src/models.ts', import.meta.url), 'utf8');

describe('manual payment confirmation persistence', () => {
  it('maps prepared manualConfirmed evidence into the immutable manuallyConfirmed snapshot field', () => {
    expect(modelsSource).toContain('readonly manuallyConfirmed?: boolean;');
    expect(ordersSource).toContain('manuallyConfirmed: part.manualConfirmed');
    expect(ordersSource).not.toContain('manuallyConfirmed: part.manuallyConfirmed');
  });
});
