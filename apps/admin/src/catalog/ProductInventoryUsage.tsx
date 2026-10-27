import type { ProductAdvancedModel } from './catalogAdvancedDraft';
import { formatQuantityMicrosForInput } from './catalogAdvancedDraft';

type ProductInventoryUsageProps = {
  inventoryItems: ProductAdvancedModel['inventoryItems'];
  quantities: Record<string, string>;
  readOnly: boolean;
  onQuantityChange(itemId: string, value: string): void;
};

/**
 * Catalog recipe draft entry. This is deliberately a single flat list of keyed inputs:
 * flex order changes the group while typing without remounting the focused input.
 */
export function ProductInventoryUsage({
  inventoryItems,
  quantities,
  readOnly,
  onQuantityChange,
}: ProductInventoryUsageProps) {
  const rows = inventoryItems.map((item) => {
    const raw =
      quantities[item.inventoryItemId] ??
      (item.quantityMicros === null ? '0' : formatQuantityMicrosForInput(item.quantityMicros));
    return { ...item, quantity: raw, used: Number(raw) > 0 };
  });
  const usedCount = rows.filter((row) => row.used).length;

  return (
    <>
      <p className="admin-catalog-inventory-usage__intro">
        <strong>{usedCount} of {rows.length} in use</strong>
        {' · '}Quantity consumed when one unit of this product is sold.
      </p>
      <p className="admin-catalog-inventory-usage__hint">
        All inventory items are listed. Just enter an amount. <strong>0 = not used.</strong>
      </p>
      {rows.length === 0 ? (
        <p className="admin-field__help">No recipe-tracked inventory items are available.</p>
      ) : (
        <div className="admin-catalog-inventory-usage__list">
          <div className="admin-catalog-inventory-usage__labels" aria-hidden="true">
            <span>Inventory item</span>
            <span>Qty / product</span>
            <span>Unit</span>
          </div>
          <div className="admin-catalog-inventory-usage__group-heading is-used">
            <strong>Used in this product</strong>
            <span>{usedCount} items</span>
          </div>
          <div className="admin-catalog-inventory-usage__group-heading is-other">
            <strong>Other inventory items</strong>
            <span>{rows.length - usedCount} items</span>
          </div>
          {rows.map((item) => (
            <label
              className="admin-catalog-inventory-usage__row"
              data-inventory-used={item.used ? 'true' : 'false'}
              style={{ order: item.used ? 1 : 3 }}
              key={item.inventoryItemId}
            >
              <span className="admin-catalog-inventory-usage__name">
                <span className="admin-catalog-inventory-usage__dot" aria-hidden="true" />
                {item.name}
              </span>
              <input
                type="number"
                min="0"
                step="0.000001"
                inputMode="decimal"
                value={item.quantity}
                disabled={readOnly || (!item.active && !item.used)}
                aria-label={`${item.name} quantity in ${item.unitLabel}`}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (!item.active && Number(value) > 0) return;
                  onQuantityChange(item.inventoryItemId, value);
                }}
              />
              <span className="admin-catalog-inventory-usage__unit">{item.unitLabel}</span>
            </label>
          ))}
        </div>
      )}
      <p className="admin-catalog-inventory-usage__footnote">Recipe, not stock balance.</p>
    </>
  );
}
