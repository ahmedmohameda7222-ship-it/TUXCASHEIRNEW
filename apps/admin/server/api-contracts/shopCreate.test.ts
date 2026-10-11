import { describe, expect, it } from 'vitest';

import { shopCreateCommandSchema } from '../settings/shopCreateRoute';

const valid = {
  contextShopId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'New Branch',
  address: null,
  contactPhone: null,
  commandId: 'stable-command-id',
};

describe('Admin shop creation contract', () => {
  it('accepts only a concrete authorized context and a stable retry key', () => {
    expect(shopCreateCommandSchema.safeParse(valid).success).toBe(true);
    expect(shopCreateCommandSchema.safeParse({ ...valid, commandId: '' }).success).toBe(false);
    expect(
      shopCreateCommandSchema.safeParse({ ...valid, contextShopId: 'all-shops' }).success,
    ).toBe(false);
  });

  it('rejects implicit copy requests, arbitrary business IDs, and unsafe unknown fields', () => {
    expect(shopCreateCommandSchema.safeParse({ ...valid, businessId: 'forged' }).success).toBe(
      false,
    );
    expect(shopCreateCommandSchema.safeParse({ ...valid, copyCatalog: true }).success).toBe(false);
    expect(shopCreateCommandSchema.safeParse({ ...valid, name: ' ' }).success).toBe(false);
    expect(shopCreateCommandSchema.safeParse({ ...valid, address: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});
