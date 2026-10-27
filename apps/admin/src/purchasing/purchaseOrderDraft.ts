import type { AdminPurchasingInventoryItem } from '@tux/admin-contracts';

export type PurchaseOrderDraftLine = {
  inventoryItemId: string;
  purchaseUnitLabel: string;
  orderedPurchaseUnitsMicros: number;
  expectedPurchaseUnitCostMinor: number;
};

/** Parse exact positive business quantities without IEEE-754 rounding. */
function parseFixed(value: string, decimals: number, allowZero: boolean): number | null {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) return null;
  const [whole, fractional = ''] = trimmed.split('.');
  if (fractional.length > decimals) return null;
  const factor = 10n ** BigInt(decimals);
  const parsed = BigInt(whole ?? '0') * factor + BigInt(fractional.padEnd(decimals, '0') || '0');
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER) || (!allowZero && parsed === 0n)) return null;
  return Number(parsed);
}

export function parsePurchaseDecimalMicros(value: string): number | null {
  return parseFixed(value, 6, false);
}

export function parsePurchaseMoneyMinor(value: string): number | null {
  return parseFixed(value, 2, true);
}

export function formatPurchaseMicros(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_micros');
  const n = BigInt(value);
  const whole = n / 1_000_000n;
  const fractional = String(n % 1_000_000n)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fractional ? `${whole}.${fractional}` : String(whole);
}

/** Format minor EGP units exactly, including large safe-integer values. */
export function formatPurchaseMoneyMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error('invalid_money_minor');
  const value = BigInt(minor);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

export function calculatePurchaseOrderSubtotalMinor(
  lines: readonly PurchaseOrderDraftLine[],
): number {
  let sum = 0n;
  for (const line of lines) {
    if (
      !Number.isSafeInteger(line.orderedPurchaseUnitsMicros) ||
      !Number.isSafeInteger(line.expectedPurchaseUnitCostMinor) ||
      line.orderedPurchaseUnitsMicros <= 0 ||
      line.expectedPurchaseUnitCostMinor < 0
    ) {
      throw new Error('invalid_purchase_order_line');
    }
    sum +=
      (BigInt(line.orderedPurchaseUnitsMicros) * BigInt(line.expectedPurchaseUnitCostMinor) +
        500_000n) /
      1_000_000n;
  }
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('purchase_order_subtotal_overflow');
  return Number(sum);
}

export function validatePurchaseOrderLines(
  lines: readonly PurchaseOrderDraftLine[],
  inventoryItems: readonly Pick<AdminPurchasingInventoryItem, 'id' | 'purchaseUnits'>[],
): string | null {
  if (lines.length < 1 || lines.length > 500) return 'Add between 1 and 500 purchase-order lines.';
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const item = inventoryItems.find((candidate) => candidate.id === line.inventoryItemId);
    if (!item) return `Line ${index + 1}: select a valid inventory item.`;
    const label = line.purchaseUnitLabel.trim().toLocaleLowerCase('en');
    if (!item.purchaseUnits?.some((unit) => unit.label.trim().toLocaleLowerCase('en') === label)) {
      return `Line ${index + 1}: select a supported purchase unit.`;
    }
    if (
      !Number.isSafeInteger(line.orderedPurchaseUnitsMicros) ||
      line.orderedPurchaseUnitsMicros <= 0
    ) {
      return `Line ${index + 1}: enter a positive quantity.`;
    }
    if (
      !Number.isSafeInteger(line.expectedPurchaseUnitCostMinor) ||
      line.expectedPurchaseUnitCostMinor < 0
    ) {
      return `Line ${index + 1}: enter a valid expected cost.`;
    }
    const key = item.id;
    if (seen.has(key)) return `Line ${index + 1}: duplicate inventory item.`;
    seen.add(key);
  }
  return null;
}
