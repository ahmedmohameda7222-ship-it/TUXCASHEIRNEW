import type { CatalogProductDetail } from '@tux/admin-contracts';
import { useMemo, useState, type FormEvent } from 'react';

export type ProductEditorDraft = {
  product: CatalogProductDetail;
  changedPaths: string[];
};

export type ProductEditorProps = {
  product: CatalogProductDetail;
  canEdit: boolean;
  canPrice: boolean;
  initialAdvancedOpen?: boolean;
  busy?: boolean;
  onSaveDraft(draft: ProductEditorDraft): void | Promise<void>;
  onSetAvailability(soldOut: boolean): void | Promise<void>;
};

const MAX_POSTGRES_INTEGER = 2_147_483_647;

export function formatEgpMinor(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POSTGRES_INTEGER) {
    throw new Error('invalid_price_minor');
  }
  const pounds = Math.floor(value / 100);
  const piasters = value % 100;
  return `${pounds}.${String(piasters).padStart(2, '0')}`;
}

export function parseEgpToMinor(value: string): number {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error('invalid_price');

  const pounds = Number(match[1]);
  const fraction = match[2] ?? '';
  const piasters = fraction.length === 0 ? 0 : Number(fraction.padEnd(2, '0'));
  const minor = pounds * 100 + piasters;
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > MAX_POSTGRES_INTEGER) {
    throw new Error('invalid_price');
  }
  return minor;
}

function changedPathsFor(original: CatalogProductDetail, next: CatalogProductDetail): string[] {
  const paths: string[] = [];
  if (original.name !== next.name) paths.push('products[].name');
  if (original.description !== next.description) paths.push('products[].description');
  if (original.priceMinor !== next.priceMinor) paths.push('products[].priceMinor');
  if (original.imageKey !== next.imageKey) paths.push('products[].imageKey');
  if (original.active !== next.active) paths.push('products[].active');
  if (original.bestSeller !== next.bestSeller) paths.push('products[].bestSeller');
  return paths;
}

export function ProductEditor({
  product,
  canEdit,
  canPrice,
  initialAdvancedOpen = false,
  busy = false,
  onSaveDraft,
  onSetAvailability,
}: ProductEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(initialAdvancedOpen);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [price, setPrice] = useState(() => formatEgpMinor(product.priceMinor));
  const [imageKey, setImageKey] = useState(product.imageKey ?? '');
  const [bestSeller, setBestSeller] = useState(product.bestSeller);

  const readOnly = !canEdit || busy;
  const priceReadOnly = readOnly || !canPrice;
  const statusCopy = product.soldOut ? 'Mark available' : 'Mark sold out';
  const nextSoldOut = !product.soldOut;

  const draftPreview = useMemo(() => {
    let priceMinor = product.priceMinor;
    try {
      if (canPrice) priceMinor = parseEgpToMinor(price);
    } catch {
      // Validation is surfaced on submit; keep the preview stable while typing.
    }
    return {
      ...product,
      name: name.trim(),
      description: description.trim() || null,
      priceMinor,
      imageKey: imageKey.trim() || null,
      bestSeller,
    };
  }, [bestSeller, canPrice, description, imageKey, name, price, product]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const next: CatalogProductDetail = {
      ...draftPreview,
      priceMinor: canPrice ? parseEgpToMinor(price) : product.priceMinor,
    };
    if (!next.name) throw new Error('invalid_product_name');
    await onSaveDraft({ product: next, changedPaths: changedPathsFor(product, next) });
  }

  async function archiveProduct() {
    if (readOnly) return;
    const next = { ...draftPreview, active: false };
    await onSaveDraft({ product: next, changedPaths: changedPathsFor(product, next) });
  }

  return (
    <form className="admin-catalog-editor" onSubmit={(event) => void submit(event)}>
      <section className="admin-catalog-editor__section" aria-labelledby="catalog-general-heading">
        <div className="admin-catalog-editor__section-heading">
          <div>
            <p className="admin-catalog-editor__eyebrow">General</p>
            <h2 id="catalog-general-heading">Product details</h2>
          </div>
          <span className={product.active ? 'admin-status-pill' : 'admin-status-pill is-muted'}>
            {product.active ? 'Active' : 'Archived'}
          </span>
        </div>

        <label className="admin-field">
          <span>Name</span>
          <input
            name="name"
            value={name}
            disabled={readOnly}
            maxLength={160}
            required
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <label className="admin-field">
          <span>Description</span>
          <textarea
            name="description"
            value={description}
            disabled={readOnly}
            maxLength={600}
            rows={3}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </label>
      </section>

      <section className="admin-catalog-editor__section" aria-labelledby="catalog-pricing-heading">
        <div className="admin-catalog-editor__section-heading">
          <div>
            <p className="admin-catalog-editor__eyebrow">Pricing</p>
            <h2 id="catalog-pricing-heading">Price</h2>
          </div>
          <span className="admin-catalog-editor__currency">EGP</span>
        </div>
        <label
          className="admin-field"
          data-catalog-price-readonly={priceReadOnly ? 'true' : 'false'}
        >
          <span>Price</span>
          <div className="admin-money-field">
            <span>EGP</span>
            <input
              name="price"
              inputMode="decimal"
              value={price}
              disabled={priceReadOnly}
              aria-describedby={!canPrice ? 'catalog-price-permission' : undefined}
              onChange={(event) => setPrice(event.currentTarget.value)}
            />
          </div>
        </label>
        {!canPrice ? (
          <p className="admin-field__help" id="catalog-price-permission">
            Pricing requires catalog.pricing access.
          </p>
        ) : null}
      </section>

      <section
        className="admin-catalog-editor__section"
        aria-labelledby="catalog-availability-heading"
      >
        <div className="admin-catalog-editor__section-heading">
          <div>
            <p className="admin-catalog-editor__eyebrow">Availability</p>
            <h2 id="catalog-availability-heading">Live availability</h2>
          </div>
          <span className={product.soldOut ? 'admin-status-pill is-warning' : 'admin-status-pill'}>
            {product.soldOut ? 'Sold out' : 'Available'}
          </span>
        </div>
        <p className="admin-field__help">This change goes live immediately.</p>
        <button
          className="admin-secondary-button"
          type="button"
          disabled={readOnly}
          onClick={() => void onSetAvailability(nextSoldOut)}
        >
          {statusCopy}
        </button>
      </section>

      <section className="admin-catalog-editor__section" aria-labelledby="catalog-images-heading">
        <div className="admin-catalog-editor__section-heading">
          <div>
            <p className="admin-catalog-editor__eyebrow">Images</p>
            <h2 id="catalog-images-heading">Image metadata</h2>
          </div>
        </div>
        <label className="admin-field">
          <span>Image object key</span>
          <input
            name="imageKey"
            value={imageKey}
            disabled={readOnly}
            maxLength={500}
            placeholder="products/example.png"
            onChange={(event) => setImageKey(event.currentTarget.value)}
          />
        </label>
        <label className="admin-check-field">
          <input
            type="checkbox"
            checked={bestSeller}
            disabled={readOnly}
            onChange={(event) => setBestSeller(event.currentTarget.checked)}
          />
          <span>Best seller</span>
        </label>
      </section>

      <button
        className="admin-disclosure-button"
        type="button"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((current) => !current)}
      >
        <span>More</span>
        <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
      </button>

      {advancedOpen ? (
        <div className="admin-catalog-editor__advanced" data-catalog-advanced>
          {[
            'Extras / Modifiers',
            'Combo Options',
            'Recipe / Inventory',
            'Shop Overrides',
            'History',
          ].map((title) => (
            <section className="admin-catalog-editor__section is-compact" key={title}>
              <h2>{title}</h2>
              <p className="admin-field__help">
                This panel uses the canonical catalog authority and is expanded in the next catalog
                workflow tasks.
              </p>
            </section>
          ))}
        </div>
      ) : null}

      <footer className="admin-catalog-editor__actions">
        <button className="admin-primary-button" type="submit" disabled={readOnly}>
          Save draft
        </button>
        <button
          className="admin-danger-link"
          type="button"
          disabled={readOnly || !product.active}
          onClick={() => void archiveProduct()}
        >
          Archive product
        </button>
      </footer>
    </form>
  );
}
