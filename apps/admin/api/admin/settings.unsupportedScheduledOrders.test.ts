import { describe, expect, it } from 'vitest';

import { settingsCommandSchema } from './settings';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';

describe('unsupported scheduled-order setting', () => {
  it('rejects writes until a trusted scheduled-order contract exists', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.override.upsert',
        shopId,
        settingKey: 'checkout.allowScheduledOrders',
        value: true,
        expectedVersion: null,
      }).success,
    ).toBe(false);
  });
});
