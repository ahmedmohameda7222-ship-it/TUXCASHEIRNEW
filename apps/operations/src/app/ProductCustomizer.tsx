import {
  parseEntityId,
  type DraftLineCustomization,
  type DraftLineId,
  type DraftModifierSelection,
  type ModifierId,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type ProductId,
} from '@tux/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatMoneyMinor } from './ordersView';

export type ProductCustomizerTarget =
  | {
      readonly kind: 'ADD';
      readonly productId: ProductId;
      readonly focusSection?: 'FULL' | 'EXTRAS';
    }
  | {
      readonly kind: 'EDIT';
      readonly lineId: DraftLineId;
      readonly focusSection?: 'FULL' | 'EXTRAS';
    };

export function ProductCustomizer({
  target,
  draft,
  configuration,
  busy,
  onCancel,
  onSubmit,
}: {
  readonly target: ProductCustomizerTarget;
  readonly draft: OrderDraft;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (customization: DraftLineCustomization) => void;
}) {
  const line =
    target.kind === 'EDIT'
      ? (draft.lines.find((candidate) => candidate.id === target.lineId) ?? null)
      : null;
  const productId = target.kind === 'ADD' ? target.productId : line?.productId;
  const product = configuration.products.find((candidate) => candidate.id === productId) ?? null;

  const modifierOptions = useMemo(() => {
    if (product === null) return [];
    return configuration.productModifierLinks
      .filter((link) => link.productId === product.id)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((link) => ({
        link,
        modifier:
          configuration.modifiers.find(
            (candidate) => candidate.id === link.modifierId && candidate.active,
          ) ?? null,
      }))
      .filter(
        (
          entry,
        ): entry is typeof entry & { readonly modifier: NonNullable<typeof entry.modifier> } =>
          entry.modifier !== null,
      );
  }, [configuration, product]);

  const beverageOptions = useMemo(() => {
    if (product === null || !product.isCombo) return [];
    return configuration.comboBeverageOptions
      .filter((option) => option.comboProductId === product.id)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((option) =>
        configuration.products.find(
          (candidate) =>
            candidate.id === option.beverageProductId && candidate.active && !candidate.soldOut,
        ),
      )
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
  }, [configuration, product]);

  const [modifierSelections, setModifierSelections] = useState<readonly DraftModifierSelection[]>(
    () =>
      line?.modifiers.map((modifier) => ({
        modifierId: modifier.modifierId,
        quantity: modifier.quantity,
      })) ?? [],
  );
  const requiredBeverageCount = product?.isCombo ? (line?.quantity ?? 1) : 0;
  const [beverages, setBeverages] = useState<readonly (ProductId | null)[]>(() => {
    const existing = line?.comboBeverages.map((beverage) => beverage.productId) ?? [];
    return Array.from({ length: requiredBeverageCount }, (_, index) => existing[index] ?? null);
  });
  const [note, setNote] = useState(line?.itemNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const extrasSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (target.focusSection !== 'EXTRAS' || modifierOptions.length === 0) return;
    const frame = window.requestAnimationFrame(() => {
      extrasSectionRef.current?.scrollIntoView({ block: 'center' });
      extrasSectionRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [modifierOptions.length, target.focusSection]);

  if (product === null) {
    return null;
  }

  function modifierQuantity(modifierId: ModifierId): number {
    return (
      modifierSelections.find((selection) => selection.modifierId === modifierId)?.quantity ?? 0
    );
  }

  function setModifierQuantity(modifierId: ModifierId, quantity: number): void {
    const option = modifierOptions.find((entry) => entry.modifier.id === modifierId);
    if (option === undefined) return;
    const bounded = Math.max(0, quantity);
    if (!Number.isSafeInteger(bounded)) return;
    if (option.link.maxQuantity !== null && bounded > option.link.maxQuantity) return;
    setModifierSelections((current) => {
      const others = current.filter((selection) => selection.modifierId !== modifierId);
      return bounded === 0 ? others : [...others, { modifierId, quantity: bounded }];
    });
  }

  function submit(): void {
    if (product === null) return;
    if (product.isCombo && beverages.some((beverage) => beverage === null)) {
      setError('Choose one included drink for each combo.');
      return;
    }
    const comboBeverageProductIds: ProductId[] = [];
    for (const beverage of beverages) {
      if (beverage !== null) comboBeverageProductIds.push(beverage);
    }
    setError(null);
    onSubmit({
      modifiers: modifierSelections,
      comboBeverageProductIds,
      itemNote: note.trim().length === 0 ? null : note,
    });
  }

  return (
    <div
      className="orders-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <section
        className="product-customizer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customizer-title"
      >
        <div className="drawer-heading">
          <div>
            <span className="drawer-kicker">
              {target.kind === 'ADD' ? 'Add item' : 'Edit item'}
            </span>
            <h2 id="customizer-title">{product.name}</h2>
          </div>
          <button type="button" className="quiet-action" disabled={busy} onClick={onCancel}>
            Close
          </button>
        </div>

        <div className="customizer-scroll">
          {product.isCombo ? (
            <section className="customizer-section" aria-labelledby="combo-drinks-title">
              <div className="section-heading-row">
                <h3 id="combo-drinks-title">Included drink</h3>
                <span>Required</span>
              </div>
              {Array.from({ length: requiredBeverageCount }, (_, index) => (
                <label className="field-stack" key={`beverage-${index}`}>
                  <span>{requiredBeverageCount === 1 ? 'Drink' : `Combo ${index + 1}`}</span>
                  <select
                    value={beverages[index] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      const next = [...beverages];
                      next[index] = value === '' ? null : parseEntityId<ProductId>(value);
                      setBeverages(next);
                    }}
                  >
                    <option value="">Choose a drink</option>
                    {beverageOptions.map((beverage) => (
                      <option value={beverage.id} key={beverage.id}>
                        {beverage.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
          ) : null}

          {modifierOptions.length > 0 ? (
            <section
              ref={extrasSectionRef}
              className="customizer-section"
              aria-labelledby="extras-title"
              tabIndex={-1}
            >
              <div className="section-heading-row">
                <h3 id="extras-title">Extras</h3>
                <span>Optional</span>
              </div>
              <div className="modifier-list">
                {modifierOptions.map(({ modifier, link }) => {
                  const quantity = modifierQuantity(modifier.id);
                  return (
                    <div className="modifier-row" key={modifier.id}>
                      <div>
                        <strong>{modifier.name}</strong>
                        <span>{formatMoneyMinor(modifier.priceMinor)}</span>
                      </div>
                      <div className="quantity-control" aria-label={`${modifier.name} quantity`}>
                        <button
                          type="button"
                          onClick={() => setModifierQuantity(modifier.id, quantity - 1)}
                          disabled={busy || quantity === 0}
                          aria-label={`Remove one ${modifier.name}`}
                        >
                          −
                        </button>
                        <output>{quantity}</output>
                        <button
                          type="button"
                          onClick={() => setModifierQuantity(modifier.id, quantity + 1)}
                          disabled={
                            busy || (link.maxQuantity !== null && quantity >= link.maxQuantity)
                          }
                          aria-label={`Add one ${modifier.name}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="customizer-section" aria-labelledby="item-note-title">
            <h3 id="item-note-title">Item note</h3>
            <textarea
              rows={3}
              value={note}
              maxLength={240}
              placeholder="Only for this item"
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
            />
          </section>

          {error === null ? null : (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="drawer-footer">
          <button type="button" className="secondary-action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary-action" disabled={busy} onClick={submit}>
            {target.kind === 'ADD' ? 'Add to order' : 'Save item'}
          </button>
        </div>
      </section>
    </div>
  );
}
