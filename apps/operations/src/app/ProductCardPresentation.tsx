import type { Product } from '@tux/domain';
import { useState } from 'react';
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
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

export function ProductCardPresentation({
  product,
  showDescription,
  quantity,
}: {
  readonly product: Product;
  readonly showDescription: boolean;
  readonly quantity?: number;
}) {
  return (
    <div className="product-card-presentation" data-product-presentation="true">
      <div className="product-media" data-product-media="true">
        <ProductMedia product={product} />
        {quantity !== undefined && quantity > 0 ? (
          <span className="product-quantity-badge" aria-label={`${quantity} in current order`}>
            {quantity}
          </span>
        ) : null}
      </div>
      <div className="product-copy">
        <strong>{product.name}</strong>
        {showDescription && product.description?.trim() ? <p>{product.description}</p> : null}
        {product.soldOut ? <em>Sold Out</em> : null}
      </div>
      <strong className="product-price">{formatMoneyMinor(product.priceMinor)}</strong>
    </div>
  );
}
