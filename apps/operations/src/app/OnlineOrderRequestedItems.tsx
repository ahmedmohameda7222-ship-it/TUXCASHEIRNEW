interface ReviewedModifier {
  readonly label: string;
  readonly quantity: number;
}

export interface ReviewedOnlineOrderItem {
  readonly productName: string;
  readonly quantity: number;
  readonly modifiers: readonly ReviewedModifier[];
  readonly comboBeverageLabel: string | null;
  readonly note: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseModifier(value: unknown): ReviewedModifier | null {
  const source = record(value);
  if (source === null) return null;
  const label = nonEmptyString(source.label);
  const quantity = positiveInteger(source.quantity);
  return label === null || quantity === null ? null : { label, quantity };
}

function parseItem(value: unknown): ReviewedOnlineOrderItem | null {
  const source = record(value);
  if (source === null || !Array.isArray(source.modifiers)) return null;

  const productName = nonEmptyString(source.productName);
  const quantity = positiveInteger(source.quantity);
  if (productName === null || quantity === null) return null;

  const modifiers = source.modifiers.map(parseModifier);
  if (modifiers.some((modifier) => modifier === null)) return null;

  let comboBeverageLabel: string | null = null;
  if (source.comboBeverage !== null) {
    const comboBeverage = record(source.comboBeverage);
    comboBeverageLabel = nonEmptyString(comboBeverage?.label);
    if (comboBeverageLabel === null) return null;
  }

  const note = source.note === null ? null : nonEmptyString(source.note);
  if (source.note !== null && note === null) return null;

  return {
    productName,
    quantity,
    modifiers: modifiers as ReviewedModifier[],
    comboBeverageLabel,
    note,
  };
}

export function parseOnlineOrderRequestedItems(
  trustedItems: readonly unknown[],
): readonly ReviewedOnlineOrderItem[] | null {
  if (trustedItems.length === 0) return null;
  const items = trustedItems.map(parseItem);
  return items.some((item) => item === null) ? null : (items as ReviewedOnlineOrderItem[]);
}

export function OnlineOrderRequestedItems({
  items,
}: {
  readonly items: readonly ReviewedOnlineOrderItem[];
}) {
  return (
    <section className="online-order-authority-note" aria-label="Requested items">
      <strong>Requested items</strong>
      {items.map((item, itemIndex) => (
        <div key={`${item.productName}:${itemIndex}`}>
          <p>
            <strong>
              {item.quantity} × {item.productName}
            </strong>
          </p>
          {item.modifiers.map((modifier, modifierIndex) => (
            <p key={`${modifier.label}:${modifierIndex}`}>
              {modifier.quantity} × {modifier.label}
            </p>
          ))}
          {item.comboBeverageLabel === null ? null : (
            <p>Combo drink: {item.comboBeverageLabel}</p>
          )}
          {item.note === null ? null : <p>Item note: {item.note}</p>}
        </div>
      ))}
    </section>
  );
}
