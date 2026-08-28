import type { MenuCategory, Product, ProductId, WorkerUiPreferences } from '@tux/domain';
import { useMemo, useRef, useState } from 'react';
import {
  moveProductWithinCategory,
  moveProductWithinCategoryByOffset,
  reconcileProductOrder,
  resetProductCategoryOrder,
} from './menuProductOrder';
import { formatMoneyMinor } from './ordersView';
import { productOrderPreferenceInput } from './workerUiPreferenceEditing';

interface ProductPositionPreferenceClient {
  update(input: {
    readonly categoryOrder: WorkerUiPreferences['categoryOrder'];
    readonly categoryAlignment: WorkerUiPreferences['categoryAlignment'];
    readonly productOrder: readonly ProductId[];
  }): Promise<WorkerUiPreferences>;
}

export interface ProductPositionEditorProps {
  readonly category: MenuCategory;
  readonly products: readonly Product[];
  readonly preference: WorkerUiPreferences | null;
  readonly preferenceClient: ProductPositionPreferenceClient;
  readonly onSaved: (preference: WorkerUiPreferences) => void;
  readonly onCancel: () => void;
}

function productInitials(product: Product): string {
  return product.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join('');
}

function canonicalCategoryProductIds(
  products: readonly Product[],
  category: MenuCategory,
): readonly ProductId[] {
  return products
    .filter((product) => product.active && product.categoryId === category.id)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((product) => product.id);
}

export function shouldHandleProductReorderCardKeyEvent(
  eventTarget: unknown,
  currentTarget: unknown,
): boolean {
  return eventTarget === currentTarget;
}

export function ProductPositionEditor({
  category,
  products,
  preference,
  preferenceClient,
  onSaved,
  onCancel,
}: ProductPositionEditorProps) {
  const initialOrder = useMemo(
    () => reconcileProductOrder(products, preference).map((product) => product.id),
    [preference, products],
  );
  const canonicalCategoryIds = useMemo(
    () => canonicalCategoryProductIds(products, category),
    [category, products],
  );
  const byId = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const pickupSnapshotRef = useRef<readonly ProductId[] | null>(null);

  const [order, setOrder] = useState<readonly ProductId[]>(initialOrder);
  const [draggingId, setDraggingId] = useState<ProductId | null>(null);
  const [grabbedId, setGrabbedId] = useState<ProductId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(
    `Reordering ${category.name}. Drag cards or use the move controls.`,
  );

  const categoryOrder = order.filter((productId) => canonicalCategoryIds.includes(productId));
  const categoryProducts = categoryOrder
    .map((productId) => byId.get(productId))
    .filter((product): product is Product => product !== undefined);

  function announcePosition(productId: ProductId, nextOrder: readonly ProductId[]): void {
    const categoryOnly = nextOrder.filter((candidate) => canonicalCategoryIds.includes(candidate));
    const position = categoryOnly.indexOf(productId);
    const product = byId.get(productId);
    if (product !== undefined && position >= 0) {
      setAnnouncement(
        `${product.name} moved to position ${position + 1} of ${categoryOnly.length}.`,
      );
    }
  }

  function moveTo(sourceId: ProductId, targetId: ProductId): void {
    setOrder((current) => {
      const next = moveProductWithinCategory(current, canonicalCategoryIds, sourceId, targetId);
      if (next !== current) announcePosition(sourceId, next);
      return next;
    });
  }

  function moveBy(sourceId: ProductId, offset: -1 | 1): void {
    setOrder((current) => {
      const next = moveProductWithinCategoryByOffset(
        current,
        canonicalCategoryIds,
        sourceId,
        offset,
      );
      if (next !== current) announcePosition(sourceId, next);
      return next;
    });
  }

  function togglePickup(productId: ProductId): void {
    if (grabbedId === productId) {
      setGrabbedId(null);
      pickupSnapshotRef.current = null;
      const product = byId.get(productId);
      setAnnouncement(`${product?.name ?? 'Product'} dropped.`);
      return;
    }
    pickupSnapshotRef.current = order;
    setGrabbedId(productId);
    const product = byId.get(productId);
    setAnnouncement(
      `${product?.name ?? 'Product'} picked up. Use arrow keys to move, Enter or Space to drop, Escape to cancel.`,
    );
  }

  function cancelPickup(): void {
    if (grabbedId === null) return;
    const product = byId.get(grabbedId);
    const snapshot = pickupSnapshotRef.current;
    if (snapshot !== null) setOrder(snapshot);
    setGrabbedId(null);
    pickupSnapshotRef.current = null;
    setAnnouncement(`${product?.name ?? 'Product'} movement cancelled.`);
  }

  function resetCategory(): void {
    setOrder((current) => resetProductCategoryOrder(current, canonicalCategoryIds));
    setGrabbedId(null);
    pickupSnapshotRef.current = null;
    setError(null);
    setAnnouncement(`${category.name} restored to its default product order. Save to keep it.`);
  }

  async function save(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await preferenceClient.update(
        productOrderPreferenceInput(preference, order, false),
      );
      onSaved(saved);
    } catch {
      setError('Could not save product order. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="product-position-editor"
      aria-labelledby="product-position-editor-title"
      style={{ display: 'flex', flexDirection: 'column' }}
    >
      <header className="product-reorder-cue">
        <div>
          <span className="product-reorder-kicker">Reordering</span>
          <h2 id="product-position-editor-title">Reordering {category.name}</h2>
          <p>Drag cards or use the move controls. Changes are saved only when you choose Save.</p>
        </div>
      </header>

      {error === null ? null : (
        <div className="product-reorder-error" role="alert">
          {error}
        </div>
      )}

      <div
        className="product-grid product-reorder-grid"
        role="list"
        aria-label={`${category.name} product order`}
        style={{ flex: 1 }}
      >
        {categoryProducts.map((product, index) => {
          const isDragging = draggingId === product.id;
          const isGrabbed = grabbedId === product.id;
          return (
            <article
              key={product.id}
              className={`product-card product-card-reordering${isDragging ? ' product-card-dragging' : ''}${isGrabbed ? ' product-card-grabbed' : ''}`}
              role="listitem"
              tabIndex={0}
              draggable={!saving}
              aria-label={`${product.name}, position ${index + 1} of ${categoryProducts.length}`}
              onDragStart={(event) => {
                if (saving) {
                  event.preventDefault();
                  return;
                }
                setDraggingId(product.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', product.id);
                setAnnouncement(`${product.name} picked up for dragging.`);
              }}
              onDragOver={(event) => {
                if (draggingId === null || draggingId === product.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDragEnter={(event) => {
                if (draggingId === null || draggingId === product.id) return;
                event.preventDefault();
                moveTo(draggingId, product.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDraggingId(null);
                setAnnouncement(`${product.name} position updated. Save to keep the new order.`);
              }}
              onDragEnd={() => setDraggingId(null)}
              onKeyDown={(event) => {
                if (
                  saving ||
                  !shouldHandleProductReorderCardKeyEvent(event.target, event.currentTarget)
                ) {
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  togglePickup(product.id);
                  return;
                }
                if (event.key === 'Escape' && grabbedId === product.id) {
                  event.preventDefault();
                  cancelPickup();
                  return;
                }
                if (grabbedId !== product.id) return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveBy(product.id, -1);
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveBy(product.id, 1);
                }
              }}
            >
              <div className="product-main product-reorder-main">
                <div className="product-media">
                  {product.imageKey === null ? (
                    <div className="product-image-fallback" aria-hidden="true">
                      {productInitials(product)}
                    </div>
                  ) : (
                    <img
                      className="product-image"
                      src={product.imageKey}
                      alt=""
                      draggable={false}
                    />
                  )}
                </div>
                <div className="product-copy">
                  <div className="product-name-row">
                    <strong>{product.name}</strong>
                    <span className="product-reorder-handle" aria-hidden="true">
                      ⋮⋮
                    </span>
                  </div>
                  <span className="product-price">{formatMoneyMinor(product.priceMinor)}</span>
                  <span className="product-reorder-position">Position {index + 1}</span>
                </div>
              </div>
              <footer className="product-reorder-footer">
                <button
                  type="button"
                  className="product-reorder-move"
                  disabled={saving || index === 0}
                  aria-label={`Move ${product.name} earlier`}
                  onClick={() => moveBy(product.id, -1)}
                >
                  ←
                </button>
                <button
                  type="button"
                  className="product-reorder-move"
                  disabled={saving || index === categoryProducts.length - 1}
                  aria-label={`Move ${product.name} later`}
                  onClick={() => moveBy(product.id, 1)}
                >
                  →
                </button>
              </footer>
            </article>
          );
        })}
      </div>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <footer className="product-reorder-actions" aria-label="Product order actions">
        <button type="button" className="text-action" disabled={saving} onClick={resetCategory}>
          Reset
        </button>
        <div className="product-reorder-actions-primary">
          <button type="button" className="secondary-action" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </footer>
    </section>
  );
}
