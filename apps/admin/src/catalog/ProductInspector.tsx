import type {
  CatalogCategorySummary,
  CatalogJsonObject,
  CatalogProductDetail,
} from '@tux/admin-contracts';

import { ProductEditor, type ProductEditorDraft } from './ProductEditor';

export function ProductInspector({
  product,
  categories = [],
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
  return (
    <section
      className="admin-catalog-inspector"
      data-catalog-inspector
      role="dialog"
      aria-label="Product editor"
      aria-modal="true"
    >
      <header className="admin-catalog-inspector__header">
        <button className="admin-catalog-back" type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>Products</span>
        </button>
        <div>
          <p className="admin-catalog-editor__eyebrow">
            Product editor · Save draft before publishing
          </p>
          <h2>{product.name}</h2>
        </div>
        {draftRevision === null ? (
          <span className="admin-status-pill is-muted">Live</span>
        ) : (
          <span className="admin-status-pill">Draft changes</span>
        )}
        {onReviewPublish ? (
          <button
            className="admin-secondary-button admin-catalog-inspector__publish"
            type="button"
            onClick={onReviewPublish}
          >
            Review & Publish
          </button>
        ) : null}
      </header>
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
