import { Link } from 'wouter';

export function CatalogFirstRunGuide({
  hasCategories,
  productCount,
  canEdit,
  canPrice = true,
  hasCopySources,
  onManageCategories,
  onCreateProduct,
}: {
  hasCategories: boolean;
  productCount: number;
  canEdit: boolean;
  canPrice?: boolean;
  hasCopySources: boolean;
  onManageCategories(): void;
  onCreateProduct(): void;
}) {
  if (productCount > 0) return null;
  return (
    <section className="admin-publish-card" aria-labelledby="catalog-first-run-heading">
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Shop setup</p>
          <h2 id="catalog-first-run-heading">Set up this shop</h2>
        </div>
        <span className="admin-status-pill">No products yet</span>
      </div>
      <p className="admin-publish-card__copy">
        This shop currently has no products. Changes stay in a draft until reviewed and published.
        Existing shops and their published catalogs are not modified by this setup.
      </p>
      {!hasCategories ? (
        <>
          <p>Create a category before adding your first product.</p>
          {canEdit ? (
            <button className="admin-primary-button" type="button" onClick={onManageCategories}>
              Add your first category
            </button>
          ) : null}
        </>
      ) : canEdit && canPrice ? (
        <button className="admin-primary-button" type="button" onClick={onCreateProduct}>
          Create your first product
        </button>
      ) : (
        <p>Product creation requires catalog.edit and catalog.pricing permissions.</p>
      )}
      {canEdit && hasCopySources ? (
        <p>
          Or use the existing, permission-checked shop-copy workflow to stage catalog entities
          into this shop.
          {' '}
          <Link className="admin-secondary-button" href="/catalog/products/publishing">
            Copy from an existing shop
          </Link>
        </p>
      ) : null}
    </section>
  );
}
