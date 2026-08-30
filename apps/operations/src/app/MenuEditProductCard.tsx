import type { Product } from '@tux/domain';
import type { ComponentPropsWithoutRef } from 'react';
import { ProductCardPresentation } from './ProductCardPresentation';

type EditCardArticleProps = Omit<ComponentPropsWithoutRef<'article'>, 'children' | 'className'>;

export function MenuEditProductCard({
  product,
  position,
  total,
  className,
  articleProps,
}: {
  readonly product: Product;
  readonly position: number;
  readonly total: number;
  readonly className?: string;
  readonly articleProps?: EditCardArticleProps;
}) {
  return (
    <article
      {...articleProps}
      className={className ?? 'product-card menu-edit-product-card'}
      aria-label={articleProps?.['aria-label'] ?? `${product.name}, position ${position} of ${total}`}
    >
      <div className="product-main">
        <ProductCardPresentation product={product} showDescription />
      </div>
      <div className="menu-edit-product-hint" aria-hidden="true">
        Drag to reorder · Position {position}
      </div>
    </article>
  );
}
