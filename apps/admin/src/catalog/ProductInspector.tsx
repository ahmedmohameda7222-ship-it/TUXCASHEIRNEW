import type { CatalogJsonObject, CatalogProductDetail } from '@tux/admin-contracts';

import { ProductEditor, type ProductEditorDraft } from './ProductEditor';

export function ProductInspector({
  product,
  canEdit,
  canPrice,
  busy,
  draftRevision,
  advancedBundle,
  onClose,
  onRequestAdvanced,
  onSaveDraft,
  onSetAvailability,
}: {
  product: CatalogProductDetail;
  canEdit: boolean;
  canPrice: boolean;
  busy: boolean;
  draftRevision: number | null;
  advancedBundle: CatalogJsonObject | null;
  onClose(): void;
  onRequestAdvanced(): void | Promise<void>;
  onSaveDraft(draft: ProductEditorDraft): void | Promise<void>;
  onSetAvailability(soldOut: boolean): void | Promise<void>;
}) {
  return (
    <section className="admin-catalog-inspector" data-catalog-inspector>
      <header className="admin-catalog-inspector__header">
        <button className="admin-catalog-back" type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>Products</span>
        </button>
        <div>
          <p className="admin-catalog-editor__eyebrow">Product editor</p>
          <h2>{product.name}</h2>
        </div>
        {draftRevision === null ? (
          <span className="admin-status-pill is-muted">Live version</span>
        ) : (
          <span className="admin-status-pill">Draft r{draftRevision}</span>
        )}
      </header>
      <ProductEditor
        key={`${product.id}:${product.name}:${product.description}:${product.priceMinor}:${product.imageKey}:${product.bestSeller}:${product.soldOut}:${product.active}`}
        product={product}
        canEdit={canEdit}
        canPrice={canPrice}
        busy={busy}
        advancedBundle={advancedBundle}
        onRequestAdvanced={onRequestAdvanced}
        onSaveDraft={onSaveDraft}
        onSetAvailability={onSetAvailability}
      />
    </section>
  );
}
