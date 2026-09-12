import type { AdminSettingsWorkspace, AdminSettingValue } from '@tux/admin-contracts';

/** UI-only projection helpers; mutation and policy authority remain in the trusted settings BFF. */
export type SettingsSection =
  'overview' | 'shop' | 'order-types' | 'payments' | 'checkout' | 'receipts' | 'reason-codes';

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'shop', label: 'Shop' },
  { id: 'order-types', label: 'Order types' },
  { id: 'payments', label: 'Payments' },
  { id: 'checkout', label: 'Checkout' },
  { id: 'receipts', label: 'Receipts' },
  { id: 'reason-codes', label: 'Reason codes' },
] as const;

export type EffectiveSetting = {
  key: string;
  value: unknown;
  source: 'shop' | 'business' | 'unset';
  version: number | null;
};

function findSetting(
  rows: readonly AdminSettingValue[],
  key: string,
): AdminSettingValue | undefined {
  return rows.find((row) => row.key === key);
}

export function resolveWorkspaceSetting(
  workspace: AdminSettingsWorkspace,
  key: string,
): EffectiveSetting {
  const override = findSetting(workspace.shopOverrides, key);
  if (override) return { key, value: override.value, source: 'shop', version: override.version };
  const businessDefault = findSetting(workspace.businessDefaults, key);
  if (businessDefault) {
    return {
      key,
      value: businessDefault.value,
      source: 'business',
      version: businessDefault.version,
    };
  }
  return { key, value: null, source: 'unset', version: null };
}

export function settingSourceLabel(source: EffectiveSetting['source']): string {
  if (source === 'shop') return 'Shop override';
  if (source === 'business') return 'Business default';
  return 'Not configured';
}

export function displaySettingValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length === 0 ? '—' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '—';
  }
}
