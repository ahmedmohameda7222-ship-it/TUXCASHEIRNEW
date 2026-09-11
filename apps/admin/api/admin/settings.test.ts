import { describe, expect, it } from 'vitest';

import { settingsCommandSchema, settingsViewSchema } from './settings';

const shopId = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';

describe('Admin settings API contract', () => {
  it('accepts only the reviewed settings workspace view', () => {
    expect(settingsViewSchema.safeParse('workspace').success).toBe(true);
    expect(settingsViewSchema.safeParse('internal').success).toBe(false);
  });

  it('accepts version-fenced publish and archive commands', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'settings.publish',
        shopId,
        expectedSettingsVersion: 4,
      }).success,
    ).toBe(true);
    expect(
      settingsCommandSchema.safeParse({
        type: 'shop.delete-or-archive',
        shopId,
      }).success,
    ).toBe(true);
  });

  it('accepts strict business-default and shop-override writes', () => {
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.default.upsert',
        shopId,
        settingKey: 'checkout.minimumOrderMinor',
        value: 1500,
        expectedVersion: null,
      }).success,
    ).toBe(true);
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.override.upsert',
        shopId,
        settingKey: 'receipt.orderPrefix',
        value: 'MD-',
        expectedVersion: 2,
      }).success,
    ).toBe(true);
  });

  it('rejects unreviewed commands, unsafe setting keys, and malformed versions', () => {
    expect(settingsCommandSchema.safeParse({ type: 'settings.anything', shopId }).success).toBe(false);
    expect(
      settingsCommandSchema.safeParse({
        type: 'setting.override.upsert',
        shopId,
        settingKey: '__proto__',
        value: true,
        expectedVersion: null,
      }).success,
    ).toBe(false);
    expect(
      settingsCommandSchema.safeParse({
        type: 'settings.publish',
        shopId,
        expectedSettingsVersion: -1,
      }).success,
    ).toBe(false);
  });
});
