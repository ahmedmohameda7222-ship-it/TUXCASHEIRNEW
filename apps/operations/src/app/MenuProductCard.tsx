import type { Product } from '@tux/domain';
import { useState, type MouseEvent } from 'react';
import { PlusCircleIcon } from './icons';
import { formatMoneyMinor } from './ordersView';

function ProductMedia({ product }: { readonly product: Product }) {
  const [failed, setFailed] = useState(false);
  if (product.imageKey === null || failed) {
    return (
      <div className="product-image-fallback" aria-hidden="true">
        {product.name
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part.slice(0, 1).toUpperCase())
          .join('')}
      </div>
    );
  }

  return (
    <img
      className="product-image"
      src={product.imageKey}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function MenuProductCard({
  product,
  quantity,
  supportsExtras,
  busy,
  onQuickInfo,
  onDecrement,
  onAdd,
  onExtras,
}: {
  readonly product: Product;
  readonly quantity: number;
  readonly supportsExtras: boolean;
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
        <div className="product-media">
          <ProductMedia product={product} />
          {quantity > 0 ? (
            <span className="product-quantity-badge" aria-label={`${quantity} in current order`}>
              {quantity}
            </span>
          ) : null}
        </div>
        <div className="product-copy">
          <strong>{product.name}</strong>
          {product.soldOut ? <em>Sold Out</em> : null}
        </div>
      </button>

      <footer className="product-card-footer">
        <strong className="product-price">{formatMoneyMinor(product.priceMinor)}</strong>
        {supportsExtras ? (
          <button
            type="button"
            className="product-extra-action"
            disabled={busy || product.soldOut}
            onClick={(event) => runIndependentAction(event, onExtras)}
          >
            <PlusCircleIcon />
            <span>Extra</span>
          </button>
        ) : null}
        <div className="product-card-controls">
          <div className="product-quantity" aria-label={`${product.name} quantity`}>
            <button
              type="button"
              aria-label={`Remove one ${product.name}`}
              disabled={busy || quantity === 0}
              onClick={(event) => runIndependentAction(event, onDecrement)}
            >
              −
            </button>
            <output>{quantity}</output>
            <button
              type="button"
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
