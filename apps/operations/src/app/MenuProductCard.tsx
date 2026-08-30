import type { Product } from '@tux/domain';
import type { MouseEvent } from 'react';
import { PlusCircleIcon } from './icons';
import { ProductCardPresentation } from './ProductCardPresentation';

export function MenuProductCard({
  product,
  quantity,
  busy,
  onQuickInfo,
  onDecrement,
  onAdd,
  onExtras,
}: {
  readonly product: Product;
  readonly quantity: number;
  readonly busy: boolean;
  readonly onQuickInfo: () => void;
  readonly onDecrement: () => void;
  readonly onAdd: () => void;
  readonly onExtras: () => void;
}) {
  const className = [
    'product-card',
    quantity > 0 ? 'product-card-selected' : null,
    product.soldOut ? 'product-card-sold-out' : null,
  ]
    .filter((value) => value !== null)
    .join(' ');

  function runIndependentAction(event: MouseEvent<HTMLButtonElement>, action: () => void): void {
    event.stopPropagation();
    action();
  }

  return (
    <article className={className}>
      <button
        type="button"
        className="product-main"
        onClick={onQuickInfo}
        aria-label={`Quick Info for ${product.name}`}
      >
        <ProductCardPresentation product={product} quantity={quantity} showDescription={false} />
      </button>

      <footer className="product-card-footer">
        <button
          type="button"
          className="product-extra-action"
          disabled={busy || product.soldOut}
          onClick={(event) => runIndependentAction(event, onExtras)}
        >
          <PlusCircleIcon />
          <span>Extra</span>
        </button>
        <div className="product-card-controls">
          <div className="product-quantity" aria-label={`${product.name} quantity`}>
            <button
              type="button"
              className="quantity-decrement"
              aria-label={`Remove one ${product.name}`}
              disabled={busy || quantity === 0}
              onClick={(event) => runIndependentAction(event, onDecrement)}
            >
              −
            </button>
            <output>{quantity}</output>
            <button
              type="button"
              className="quantity-increment"
              aria-label={`Add one ${product.name}`}
              disabled={busy || product.soldOut}
              onClick={(event) => runIndependentAction(event, onAdd)}
            >
              +
            </button>
          </div>
        </div>
      </footer>
    </article>
  );
}
