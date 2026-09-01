import { useSortable } from '@dnd-kit/sortable';
import type { Product, ProductId } from '@tux/domain';
import { ProductCardPresentation } from './ProductCardPresentation';

export function menuEditProductSortableId(productId: ProductId): string {
  return `product:${productId}`;
}

export function MenuEditProductCard({
  product,
  position,
  total,
  className,
  disabled = false,
}: {
  readonly product: Product;
  readonly position: number;
  readonly total: number;
  readonly className?: string;
  readonly disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: menuEditProductSortableId(product.id),
    disabled,
  });

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        className ?? 'product-card menu-edit-product-card',
        isDragging ? 'menu-edit-product-card-dragging menu-edit-product-card-grabbed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={`${product.name}, position ${position} of ${total}`}
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
