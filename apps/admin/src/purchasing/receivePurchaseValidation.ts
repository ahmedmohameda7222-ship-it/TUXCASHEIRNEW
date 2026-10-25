import { parsePurchaseDecimalMicros, parsePurchaseMoneyMinor } from './purchaseOrderDraft';

export type PurchaseMovementLine = {
  id: string;
  itemName: string;
  orderedPurchaseUnitsMicros: number;
  receivedPurchaseUnitsMicros: number;
  returnedPurchaseUnitsMicros: number;
};

type ReceiptLine = {
  lineId: string;
  receivedPurchaseUnitsMicros: number;
  purchaseUnitCostMinor: number;
};
type ReturnLine = { lineId: string; returnedPurchaseUnitsMicros: number };
type ValidationResult<T> = { ok: true; lines: T[] } | { ok: false; error: string };

/**
 * Validate every non-empty delivery line before posting any receipt. No malformed
 * quantity or missing/invalid cost may be rounded, silently skipped or coerced to
 * a zero-cost transaction. Genuine free receipts require a separate approved
 * business rule; the existing command has no field recording that authorization.
 */
export function parseReceiptLines(
  eligible: readonly PurchaseMovementLine[],
  quantities: Readonly<Record<string, string>>,
  costs: Readonly<Record<string, string>>,
): ValidationResult<ReceiptLine> {
  const lines: ReceiptLine[] = [];
  for (const line of eligible) {
    const rawQuantity = (quantities[line.id] ?? '').trim();
    const rawCost = (costs[line.id] ?? '').trim();
    if (!rawQuantity && !rawCost) continue;
    const quantity = parsePurchaseDecimalMicros(rawQuantity);
    const remaining = line.orderedPurchaseUnitsMicros - line.receivedPurchaseUnitsMicros;
    if (quantity === null || quantity > remaining) {
      return { ok: false, error: `${line.itemName}: enter a positive quantity no greater than the remaining purchase units.` };
    }
    const cost = parsePurchaseMoneyMinor(rawCost);
    if (cost === null || cost <= 0) {
      return { ok: false, error: `${line.itemName}: enter a valid positive purchase-unit cost (EGP).` };
    }
    lines.push({ lineId: line.id, receivedPurchaseUnitsMicros: quantity, purchaseUnitCostMinor: cost });
  }
  if (lines.length === 0) return { ok: false, error: 'Enter at least one valid receipt line.' };
  return { ok: true, lines };
}

export function parseReturnLines(
  eligible: readonly PurchaseMovementLine[],
  quantities: Readonly<Record<string, string>>,
): ValidationResult<ReturnLine> {
  const lines: ReturnLine[] = [];
  for (const line of eligible) {
    const raw = (quantities[line.id] ?? '').trim();
    if (!raw) continue;
    const quantity = parsePurchaseDecimalMicros(raw);
    const returnable = line.receivedPurchaseUnitsMicros - line.returnedPurchaseUnitsMicros;
    if (quantity === null || quantity > returnable) {
      return { ok: false, error: `${line.itemName}: enter a positive return quantity no greater than unreturned purchase units.` };
    }
    lines.push({ lineId: line.id, returnedPurchaseUnitsMicros: quantity });
  }
  if (lines.length === 0) return { ok: false, error: 'Enter at least one valid return line.' };
  return { ok: true, lines };
}
