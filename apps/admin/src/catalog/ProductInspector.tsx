import type {
  CatalogCategorySummary,
  CatalogJsonObject,
  CatalogProductDetail,
} from '@tux/admin-contracts';

import { useEffect } from 'react';

import { ProductEditor, type ProductEditorDraft } from './ProductEditor';

export function ProductInspector({
  product,
  categories = [],
  isNew = false,
  canEdit,
  canPrice,
  busy,
  draftRevision,
  advancedBundle,
  advancedLoadError = false,
  onClose,
  onRequestAdvanced,
  onSaveDraft,
  onReviewPublish,
  onSetAvailability,
  onUploadImage,
  imageRequiresSaveFirst = false,
}: {
  product: CatalogProductDetail;
  categories?: readonly CatalogCategorySummary[];
  isNew?: boolean;
  canEdit: boolean;
  canPrice: boolean;
  busy: boolean;
  draftRevision: number | null;
  advancedBundle: CatalogJsonObject | null;
  advancedLoadError?: boolean;
  onClose(): void;
  onRequestAdvanced(): void | Promise<void>;
  onSaveDraft(draft: ProductEditorDraft): void | Promise<void>;
  onReviewPublish?(): void;
  onSetAvailability(soldOut: boolean): void | Promise<void>;
  onUploadImage?(file: File): Promise<{ imageKey: string; publicUrl: string }>;
  imageRequiresSaveFirst?: boolean;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A confirmation dialog owns Escape while it is visible.
      if (document.querySelector('[role="dialog"][aria-label^="Discard unsaved"]')) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <section
      className="admin-catalog-inspector"
      data-catalog-inspector
      role="dialog"
      aria-label="Product editor"
      aria-modal="true"
    >
      <header className="admin-catalog-inspector__header">
        <strong>{isNew ? 'New product' : 'Edit product'}</strong>
        <button
          className="admin-secondary-button admin-catalog-inspector__close"
          type="button"
          aria-label="Close editor"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="admin-catalog-inspector__preview">
        <button className="admin-catalog-back" type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>Products</span>
        </button>
        <div className="admin-catalog-inspector__summary">
          <strong>{product.name || 'New product'}</strong>
          <span>
            {categories.find((category) => category.id === product.categoryId)?.name ?? 'Product'}
          </span>
          {draftRevision === null ? (
            <span className="admin-status-pill is-muted">Live</span>
          ) : (
            <span className="admin-status-pill">Draft changes</span>
          )}
        </div>
        <button
          className="admin-secondary-button admin-catalog-inspector__jump"
          type="button"
          onClick={() =>
            document.getElementById('catalog-inventory-usage-heading')?.scrollIntoView({
              block: 'start',
              behavior: 'smooth',
            })
          }
        >
          Jump to inventory usage
        </button>
        {onReviewPublish ? (
          <button
            className="admin-secondary-button admin-catalog-inspector__publish"
            type="button"
            onClick={onReviewPublish}
          >
            Review & Publish
          </button>
        ) : null}
      </div>
      <ProductEditor
        key={`${product.id}:${product.name}:${product.description}:${product.priceMinor}:${product.imageKey}:${product.bestSeller}:${product.soldOut}:${product.active}:${product.categoryId}:${product.isCombo}:${product.sortOrder}`}
        product={product}
        categories={categories}
        canEdit={canEdit}
        canPrice={canPrice}
        busy={busy}
        advancedBundle={advancedBundle}
        advancedLoadError={advancedLoadError}
        onRequestAdvanced={onRequestAdvanced}
        onSaveDraft={onSaveDraft}
        onReviewPublish={onReviewPublish}
        onCancel={onClose}
        onSetAvailability={onSetAvailability}
        onUploadImage={onUploadImage}
        imageRequiresSaveFirst={imageRequiresSaveFirst}
      />
    </section>
  );
}
