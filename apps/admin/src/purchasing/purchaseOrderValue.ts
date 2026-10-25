import type { AdminPurchaseOrder } from '@tux/admin-contracts';

import { calculatePurchaseOrderSubtotalMinor } from './purchaseOrderDraft';

type ExpectedLineValue = Pick<
  AdminPurchaseOrder['lines'][number],
  'orderedPurchaseUnitsMicros' | 'expectedPurchaseUnitCostMinor'
>;

/** Never silently render an unsupported or imprecise monetary total. */
export function expectedOrderValueMinor(lines: readonly ExpectedLineValue[]): number | null {
  if (lines.length === 0) return null;
  try {
    return calculatePurchaseOrderSubtotalMinor(
      lines.map((line) => ({
        inventoryItemId: '',
        purchaseUnitLabel: '',
        orderedPurchaseUnitsMicros: line.orderedPurchaseUnitsMicros,
        expectedPurchaseUnitCostMinor: line.expectedPurchaseUnitCostMinor,
      })),
    );
  } catch {
    return null;
  }
}

export function formatExpectedOrderValue(minor: number | null): string {
  if (minor === null || !Number.isSafeInteger(minor) || minor < 0) return 'Unavailable';
  const pennies = BigInt(minor);
  return `${pennies / 100n}.${String(pennies % 100n).padStart(2, '0')} EGP`;
}
