import type { InventoryBalance } from '@tux/admin-contracts';
import type { InventoryMovement } from '@tux/domain';

export function inventoryBalanceFromMovements(
  movements: readonly Pick<InventoryMovement, 'quantityDeltaMicros' | 'reservedDeltaMicros'>[],
): InventoryBalance {
  let onHandMicros = 0;
  let reservedMicros = 0;
  for (const movement of movements) {
    onHandMicros += movement.quantityDeltaMicros;
    reservedMicros += movement.reservedDeltaMicros ?? 0;
  }
  return {
    onHandMicros,
    reservedMicros,
    availableMicros: onHandMicros - reservedMicros,
  };
}
