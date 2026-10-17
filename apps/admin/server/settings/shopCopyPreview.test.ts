import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { buildSettingsCopyPreview } from './shopCopyPreview';

const source = {
  shop: { id: 'source-shop' },
  settingsVersion: 7,
  businessDefaults: [
    { key: 'checkout.taxBps', value: 1400, version: 2 },
    { key: 'receipt.orderPrefix', value: 'BUS-', version: 1 },
  ],
  shopOverrides: [{ key: 'receipt.orderPrefix', value: 'SRC-', version: 4 }],
} as AdminSettingsWorkspace;
const target = {
  ...source,
  shop: { id: 'target-shop' },
  settingsVersion: 11,
  shopOverrides: [
    { key: 'checkout.taxBps', value: 1200, version: 3 },
    { key: 'receipt.orderPrefix', value: 'TGT-', version: 5 },
  ],
} as AdminSettingsWorkspace;

describe('selective shop settings copy preview', () => {
  it('previews only explicitly selected domains with source and target provenance', () => {
    const result = buildSettingsCopyPreview(source, target, ['checkout'], 11);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceSettingsVersion).toBe(7);
    expect(result.targetSettingsVersion).toBe(11);
    expect(result.changes).toContainEqual({
      settingKey: 'checkout.taxBps',
      sourceValue: 1400,
      source: 'business',
      sourceExpectedVersion: 2,
      targetValue: 1200,
      targetSource: 'shop',
      targetExpectedVersion: 3,
      wouldChange: true,
    });
    expect(result.changes.some((row) => row.settingKey.startsWith('receipt.'))).toBe(false);
  });

  it('does not report a change when both shops already resolve the same inherited value', () => {
    const inheritingTarget = { ...target, shopOverrides: [] };
    const result = buildSettingsCopyPreview(source, inheritingTarget, ['checkout'], 11);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.find((row) => row.settingKey === 'checkout.taxBps')).toMatchObject({
      source: 'business',
      targetSource: 'business',
      sourceValue: 1400,
      targetValue: 1400,
      wouldChange: false,
    });
  });

  it('rejects stale targets rather than presenting an obsolete copy plan', () => {
    expect(buildSettingsCopyPreview(source, target, ['checkout'], 10)).toEqual({
      ok: false,
      code: 'stale_settings_version',
      currentVersion: 11,
    });
  });

  it('does not create implicit copy operations for unset source settings', () => {
    const result = buildSettingsCopyPreview(source, target, ['receipts'], 11);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changes.every((row) => row.sourceValue !== null)).toBe(true);
    expect(result.changes.find((row) => row.settingKey === 'receipt.orderPrefix')).toMatchObject({
      sourceValue: 'SRC-',
      source: 'shop',
      targetExpectedVersion: 5,
    });
  });

  it('refuses same-shop copy and unapproved domains', () => {
    expect(() => buildSettingsCopyPreview(source, source, ['checkout'], 7)).toThrow(
      'source_and_target_must_differ',
    );
    expect(() => buildSettingsCopyPreview(source, target, ['inventory' as 'checkout'], 11)).toThrow(
      'unsupported_copy_domain',
    );
  });
});
