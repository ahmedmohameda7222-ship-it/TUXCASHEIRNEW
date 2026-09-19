const BASE_MICROS_PER_UNIT = 1_000_000;

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

export function calculateWeightedAverageCost(
  current: { readonly quantity: number; readonly unitCostMinor: number },
  receipt: { readonly quantity: number; readonly unitCostMinor: number },
): number {
  const currentQuantity = finiteNonNegative(current.quantity, 'current quantity');
  const receiptQuantity = finiteNonNegative(receipt.quantity, 'receipt quantity');
  const currentCost = finiteNonNegative(current.unitCostMinor, 'current unit cost');
  const receiptCost = finiteNonNegative(receipt.unitCostMinor, 'receipt unit cost');
  const totalQuantity = currentQuantity + receiptQuantity;
  if (totalQuantity === 0) return 0;
  return (currentQuantity * currentCost + receiptQuantity * receiptCost) / totalQuantity;
}

export function calculateRecipeCost(
  lines: readonly {
    readonly quantityMicros: number;
    readonly unitCostMinor: number;
  }[],
): number {
  return lines.reduce((total, line) => {
    const quantityMicros = finiteNonNegative(line.quantityMicros, 'recipe quantity');
    const unitCostMinor = finiteNonNegative(line.unitCostMinor, 'recipe unit cost');
    return total + (quantityMicros / BASE_MICROS_PER_UNIT) * unitCostMinor;
  }, 0);
}
