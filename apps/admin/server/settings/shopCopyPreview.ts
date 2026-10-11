import type { AdminSettingValue, AdminSettingsWorkspace } from '@tux/admin-contracts';

export const COPYABLE_SETTING_DOMAINS = {
  checkout: [
    'checkout.minimumOrderMinor',
    'checkout.serviceChargeBps',
    'checkout.taxBps',
    'checkout.allowDiscountStacking',
    'checkout.allowDeliveryFeeOverride',
    'checkout.requireCustomerPhone',
  ],
  receipts: ['receipt.orderPrefix', 'receipt.footer', 'receipt.sequenceStart'],
} as const;

export type SettingsCopyDomain = keyof typeof COPYABLE_SETTING_DOMAINS;

export type SettingsCopyPreviewResult =
  | {
      ok: false;
      code: 'stale_settings_version';
      currentVersion: number;
    }
  | {
      ok: true;
      sourceShopId: string;
      targetShopId: string;
      sourceSettingsVersion: number;
      targetSettingsVersion: number;
      selectedDomains: SettingsCopyDomain[];
      changes: {
        settingKey: string;
        sourceValue: unknown;
        source: 'shop' | 'business';
        targetValue: unknown | null;
        targetSource: 'shop' | 'business' | 'unset';
        targetExpectedVersion: number | null;
        wouldChange: boolean;
      }[];
    };

function resolveLayer(
  workspace: AdminSettingsWorkspace,
  settingKey: string,
): { source: 'shop' | 'business' | 'unset'; row: AdminSettingValue | null } {
  const override = workspace.shopOverrides.find((row) => row.key === settingKey);
  if (override) return { source: 'shop', row: override };
  const fallback = workspace.businessDefaults.find((row) => row.key === settingKey);
  return fallback ? { source: 'business', row: fallback } : { source: 'unset', row: null };
}

export function buildSettingsCopyPreview(
  source: AdminSettingsWorkspace,
  target: AdminSettingsWorkspace,
  domains: readonly SettingsCopyDomain[],
  expectedTargetSettingsVersion: number,
): SettingsCopyPreviewResult {
  if (source.shop.id === target.shop.id) throw new Error('source_and_target_must_differ');
  if (
    domains.length === 0 ||
    domains.some(
      (domain) => !Object.prototype.hasOwnProperty.call(COPYABLE_SETTING_DOMAINS, domain),
    )
  ) {
    throw new Error('unsupported_copy_domain');
  }
  if (target.settingsVersion !== expectedTargetSettingsVersion) {
    return {
      ok: false,
      code: 'stale_settings_version',
      currentVersion: target.settingsVersion,
    };
  }

  const selectedDomains = [...new Set(domains)];
  const keys = selectedDomains.flatMap((domain) => [...COPYABLE_SETTING_DOMAINS[domain]]);
  const changes = keys.flatMap((settingKey) => {
    const from = resolveLayer(source, settingKey);
    if (!from.row) return [];
    const to = resolveLayer(target, settingKey);
    const targetOverride = target.shopOverrides.find((row) => row.key === settingKey);
    return [
      {
        settingKey,
        sourceValue: from.row.value,
        source: from.source as 'shop' | 'business',
        targetValue: to.row?.value ?? null,
        targetSource: to.source,
        targetExpectedVersion: targetOverride?.version ?? null,
        wouldChange:
          targetOverride === undefined ||
          JSON.stringify(targetOverride.value) !== JSON.stringify(from.row.value),
      },
    ];
  });

  return {
    ok: true,
    sourceShopId: source.shop.id,
    targetShopId: target.shop.id,
    sourceSettingsVersion: source.settingsVersion,
    targetSettingsVersion: target.settingsVersion,
    selectedDomains,
    changes,
  };
}
