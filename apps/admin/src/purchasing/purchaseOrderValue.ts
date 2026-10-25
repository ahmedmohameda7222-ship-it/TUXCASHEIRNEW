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

/**
 * A stable, human-oriented identifier when a PO has no supplier reference.
 * The opaque checksum avoids exposing a raw UUID fragment in primary UI.
 * The persisted PO identity and routing remain the full canonical UUID.
 */
export function purchaseOrderDisplayReference(
  order: Pick<AdminPurchaseOrder, 'id' | 'reference'>,
): string {
  const reference = order.reference?.trim();
  if (reference) return reference;

  let checksum = 0xcbf29ce484222325n;
  for (const character of order.id) {
    checksum ^= BigInt(character.charCodeAt(0));
    checksum = (checksum * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `PO-${checksum.toString(36).toUpperCase().padStart(13, '0')}`;
}
