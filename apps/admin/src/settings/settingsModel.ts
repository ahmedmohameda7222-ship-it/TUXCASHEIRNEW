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
  if (source === 'shop') return 'Shop setting';
  if (source === 'business') return 'Business setting';
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

function parseDecimal(raw: string, label: string): number {
  const normalized = raw.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`${label} must use no more than two decimal places.`);
  }
  return Number(normalized);
}

export function formatMinorAsEgp(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) ? (value / 100).toFixed(2) : '';
}

export function parseEgpToMinor(raw: string): number {
  const value = parseDecimal(raw, 'Amount');
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor)) throw new Error('Enter a valid amount.');
  return minor;
}

export function formatBasisPointsAsPercent(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return '';
  return (value / 100).toFixed(2);
}

export function parsePercentToBasisPoints(raw: string): number {
  const value = parseDecimal(raw, 'Percentage');
  if (value > 100) throw new Error('Percentage must be between 0 and 100.');
  return Math.round(value * 100);
}

export function sortOrderAfterMove(
  rows: readonly { id: string; sortOrder: number }[],
  currentId: string,
  direction: 'up' | 'down',
): number {
  const ordered = [...rows].sort((left, right) => left.sortOrder - right.sortOrder);
  const position = ordered.findIndex((row) => row.id === currentId);
  const current = ordered[position];
  if (!current) return 0;
  const adjacent = ordered[position + (direction === 'up' ? -1 : 1)];
  if (!adjacent) return current.sortOrder;
  return direction === 'up' ? Math.max(0, adjacent.sortOrder - 1) : adjacent.sortOrder + 1;
}
