import type {
  CatalogCategorySummary,
  CatalogJsonObject,
  CatalogProductDetail,
} from '@tux/admin-contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useUnsavedShopDraft } from '../shops/ShopScopeProvider';

import {
  buildProductAdvancedDraft,
  formatQuantityMicrosForInput,
  readProductAdvancedModel,
  type ProductAdvancedDraft,
} from './catalogAdvancedDraft';

import { ProductInventoryUsage } from './ProductInventoryUsage';

export { formatQuantityMicrosForInput, parseQuantityToMicros } from './catalogAdvancedDraft';

export type ProductEditorDraft = {
  product: CatalogProductDetail;
  changedPaths: string[];
  advanced?: ProductAdvancedDraft;
};

export type ProductEditorProps = {
  product: CatalogProductDetail;
  categories?: readonly CatalogCategorySummary[];
  canEdit: boolean;
  canPrice: boolean;
  initialAdvancedOpen?: boolean;
  advancedBundle?: CatalogJsonObject | null;
  advancedLoadError?: boolean;
  busy?: boolean;
  onRequestAdvanced?(): void | Promise<void>;
  onSaveDraft(draft: ProductEditorDraft): void | Promise<void>;
  onReviewPublish?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
  onSetAvailability(soldOut: boolean): void | Promise<void>;
  onUploadImage?: ((file: File) => Promise<{ imageKey: string; publicUrl: string }>) | undefined;
  imageRequiresSaveFirst?: boolean;
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
  if (original.active !== next.active) paths.push('products[].active');
  if (original.bestSeller !== next.bestSeller) paths.push('products[].bestSeller');
  if (original.categoryId !== next.categoryId) paths.push('products[].categoryId');
  if (original.isCombo !== next.isCombo) paths.push('products[].isCombo');
  if (original.sortOrder !== next.sortOrder) paths.push('products[].sortOrder');
  if (original.imageKey !== next.imageKey) paths.push('products[].imageKey');
  return paths;
}

export function ProductEditor({
  product,
  categories = [],
  canEdit,
  canPrice,
  initialAdvancedOpen = false,
  advancedBundle = null,
  advancedLoadError = false,
  busy = false,
  onRequestAdvanced,
  onSaveDraft,
  onReviewPublish,
  onCancel,
  onSetAvailability,
  onUploadImage,
  imageRequiresSaveFirst = false,
}: ProductEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(initialAdvancedOpen);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? '');
  const [price, setPrice] = useState(() => formatEgpMinor(product.priceMinor));
  const [bestSeller, setBestSeller] = useState(product.bestSeller);
  const [visible, setVisible] = useState(product.active);
  const [selectedCategoryId, setSelectedCategoryId] = useState(product.categoryId);
  const [comboEnabled, setComboEnabled] = useState(product.isCombo);
  const [sortOrder, setSortOrder] = useState(String(product.sortOrder));
  const [imageKey, setImageKey] = useState<string | null>(product.imageKey);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  useEffect(() => {
    if (!imageKey || uploadedImageUrl) return;
    let cancelled = false;
    const params = new URLSearchParams({ shopId: product.shopId, imageKey });
    void fetch(`/api/admin/catalog-image?${params.toString()}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('image_preview_unavailable');
        const data: unknown = await response.json();
        if (
          typeof data !== 'object' ||
          data === null ||
          !('publicUrl' in data) ||
          typeof data.publicUrl !== 'string'
        ) {
          throw new Error('image_preview_invalid');
        }
        return data.publicUrl;
      })
      .then((publicUrl) => {
        if (!cancelled) setUploadedImageUrl(publicUrl);
      })
      .catch(() => {
        // Keep image assignment intact if the public preview is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [imageKey, product.shopId, uploadedImageUrl]);
  const [modifierState, setModifierState] = useState<
    Record<string, { linked: boolean; maxQuantity: string }>
  >({});
  const [comboState, setComboState] = useState<Record<string, boolean>>({});
  const [recipeState, setRecipeState] = useState<Record<string, string>>({});
  const [recipeError, setRecipeError] = useState<string | null>(null);

  const readOnly = !canEdit || busy || imageUploading;
  const priceReadOnly = readOnly || !canPrice;
  const statusCopy = product.soldOut ? 'Mark available' : 'Mark sold out';
  const nextSoldOut = !product.soldOut;

  const advancedModel = useMemo(
    () => (advancedBundle ? readProductAdvancedModel(advancedBundle, product.id) : null),
    [advancedBundle, product.id],
  );

  useEffect(() => {
    if (!advancedModel) return;
    setModifierState(
      Object.fromEntries(
        advancedModel.modifiers.map((modifier) => [
          modifier.id,
          {
            linked: modifier.linked,
            maxQuantity: modifier.maxQuantity === null ? '' : String(modifier.maxQuantity),
          },
        ]),
      ),
    );
    setComboState(
      comboEnabled
        ? Object.fromEntries(
            advancedModel.comboOptions.map((option) => [option.productId, option.selected]),
          )
        : {},
    );
    setRecipeState(
      Object.fromEntries(
        advancedModel.inventoryItems.map((item) => [
          item.inventoryItemId,
          item.quantityMicros === null ? '0' : formatQuantityMicrosForInput(item.quantityMicros),
        ]),
      ),
    );
  }, [advancedModel, comboEnabled]);

  const baseDirty =
    name !== product.name ||
    description !== (product.description ?? '') ||
    (canPrice && price !== formatEgpMinor(product.priceMinor)) ||
    bestSeller !== product.bestSeller ||
    visible !== product.active ||
    selectedCategoryId !== product.categoryId ||
    comboEnabled !== product.isCombo ||
    sortOrder !== String(product.sortOrder) ||
    imageKey !== product.imageKey;
  const advancedDirty = advancedModel
    ? advancedModel.modifiers.some((modifier) => {
        const current = modifierState[modifier.id];
        return (
          current !== undefined &&
          (current.linked !== modifier.linked ||
            current.maxQuantity !==
              (modifier.maxQuantity === null ? '' : String(modifier.maxQuantity)))
        );
      }) ||
      advancedModel.comboOptions.some(
        (option) =>
          comboState[option.productId] !== undefined &&
          comboState[option.productId] !== option.selected,
      ) ||
      advancedModel.inventoryItems.some((item) => {
        const current = recipeState[item.inventoryItemId];
        return (
          current !== undefined &&
          current !==
            (item.quantityMicros === null ? '0' : formatQuantityMicrosForInput(item.quantityMicros))
        );
      })
    : false;
  useUnsavedShopDraft(
    baseDirty ||
      advancedDirty ||
      selectedImageFile !== null ||
      imageUploading ||
      imageRequiresSaveFirst,
  );

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
      bestSeller,
      active: visible,
      categoryId: selectedCategoryId,
      isCombo: comboEnabled,
      sortOrder: Number(sortOrder),
      imageKey,
    };
  }, [
    bestSeller,
    canPrice,
    description,
    name,
    price,
    product,
    visible,
    selectedCategoryId,
    comboEnabled,
    sortOrder,
    imageKey,
  ]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    const next: CatalogProductDetail = {
      ...draftPreview,
      priceMinor: canPrice ? parseEgpToMinor(price) : product.priceMinor,
    };
    if (!next.name) throw new Error('invalid_product_name');
    if (!next.categoryId || !Number.isSafeInteger(next.sortOrder) || next.sortOrder < 0)
      throw new Error('invalid_product_menu_structure');
    let advanced: ProductAdvancedDraft | undefined;
    try {
      advanced = advancedModel
        ? buildProductAdvancedDraft({
            shopId: product.shopId,
            productId: product.id,
            model: comboEnabled ? advancedModel : { ...advancedModel, comboOptions: [] },
            modifierState,
            comboState: comboEnabled ? comboState : {},
            recipeState,
          })
        : undefined;
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid_recipe_quantity') {
        setRecipeError('Enter a positive quantity with at most 6 decimal places, or 0 to unlink.');
        return;
      }
      throw error;
    }
    setRecipeError(null);
    await onSaveDraft({
      product: next,
      changedPaths: changedPathsFor(product, next),
      ...(advanced === undefined ? {} : { advanced }),
    });
  }

  const [archiveConfirmationOpen, setArchiveConfirmationOpen] = useState(false);

  async function uploadSelectedImage() {
    if (readOnly || imageRequiresSaveFirst || !selectedImageFile || !onUploadImage) return;
    setImageError(null);
    if (
      selectedImageFile.size === 0 ||
      selectedImageFile.size > 2 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(selectedImageFile.type)
    ) {
      setImageError('Choose a PNG, JPEG, WebP, or AVIF image of at most 2 MB.');
      return;
    }
    setImageUploading(true);
    try {
      const result = await onUploadImage(selectedImageFile);
      setImageKey(result.imageKey);
      setUploadedImageUrl(result.publicUrl);
      setSelectedImageFile(null);
    } catch {
      setImageError('Image upload failed. No image change has been saved.');
    } finally {
      setImageUploading(false);
    }
  }

  async function archiveProduct() {
    if (readOnly) return;
    const next = { ...draftPreview, active: false };
    await onSaveDraft({ product: next, changedPaths: changedPathsFor(product, next) });
  }

  function toggleAdvanced() {
    const opening = !advancedOpen;
    setAdvancedOpen(opening);
    if (opening && advancedBundle === null) void onRequestAdvanced?.();
  }

  return (
    <form className="admin-catalog-editor" onSubmit={(event) => void submit(event)}>
      <section
        className="admin-catalog-editor__section admin-catalog-product-photo"
        aria-labelledby="catalog-images-heading"
      >
        <div className="admin-catalog-editor__section-heading">
          <div>
            <p className="admin-catalog-editor__eyebrow">Images</p>
            <h2 id="catalog-images-heading">Product photo</h2>
          </div>
        </div>
        <div className="admin-catalog-image-layout">
          <div className="admin-product-image-state" role="status">
            {uploadedImageUrl ? (
              <img
                src={uploadedImageUrl}
                alt={`Selected image for ${product.name}`}
                loading="lazy"
                width="90"
                height="90"
              />
            ) : (
              <span className="admin-product-image-placeholder" aria-hidden="true">
                {product.name.trim().slice(0, 2).toUpperCase() || 'PH'}
              </span>
            )}
            <strong className="admin-product-image-state__status">
              {imageKey ? 'Image assigned' : 'No image assigned'}
            </strong>
          </div>
          {onUploadImage ? (
            <div className="admin-form-grid">
              {imageRequiresSaveFirst ? (
                <p className="admin-field__help" role="status">
                  Save this product draft first to enable image upload.
                </p>
              ) : null}
              <label className="admin-field">
                <span>Choose product image (PNG, JPEG, WebP, AVIF — maximum 2 MB)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  disabled={readOnly || imageRequiresSaveFirst}
                  onChange={(event) => {
                    setSelectedImageFile(event.currentTarget.files?.[0] ?? null);
                    setImageError(null);
                  }}
                />
              </label>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={readOnly || imageRequiresSaveFirst || selectedImageFile === null}
                onClick={() => void uploadSelectedImage()}
              >
                {imageUploading ? 'Uploading image…' : 'Upload image'}
              </button>
              {imageKey ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    setImageKey(null);
                    setUploadedImageUrl(null);
                    setSelectedImageFile(null);
                    setImageError(null);
                  }}
                >
                  Remove image from draft
                </button>
              ) : null}
              {imageError ? <p role="alert">{imageError}</p> : null}
            </div>
          ) : null}
          <p className="admin-catalog-photo-help">
            Image upload changes remain in Draft until saved and published.
          </p>
        </div>
      </section>

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
        <label className="admin-field">
          <span>Product category</span>
          <select
            value={selectedCategoryId}
            disabled={readOnly || categories.length === 0}
            onChange={(event) => setSelectedCategoryId(event.currentTarget.value)}
          >
            {categories
              .filter((category) => category.active || category.id === selectedCategoryId)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        <label className="admin-check-field">
          <input
            type="checkbox"
            checked={comboEnabled}
            disabled={readOnly}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              setComboEnabled(next);
              if (next && !advancedModel) void onRequestAdvanced?.();
            }}
          />
          <span>Combo product</span>
        </label>
        <label className="admin-field">
          <span>Sort order</span>
          <input
            type="number"
            min={0}
            step={1}
            value={sortOrder}
            disabled={readOnly}
            onChange={(event) => setSortOrder(event.currentTarget.value)}
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
        <p className="admin-catalog-live-notice" role="note">
          <strong>Immediate operation</strong>
          <span>
            This change goes live immediately. It does not save or publish your editing draft.
          </span>
        </p>
        <button
          className="admin-secondary-button"
          type="button"
          disabled={readOnly}
          onClick={() => void onSetAvailability(nextSoldOut)}
        >
          {statusCopy}
        </button>
      </section>

      <section
        className="admin-catalog-editor__section admin-catalog-inventory-usage"
        aria-labelledby="catalog-inventory-usage-heading"
      >
        <div className="admin-catalog-editor__section-heading">
          <h2 id="catalog-inventory-usage-heading">Inventory usage</h2>
          <span className="admin-catalog-inventory-usage__draft-tag">DRAFT ONLY</span>
        </div>
        {advancedModel ? (
          <ProductInventoryUsage
            inventoryItems={advancedModel.inventoryItems}
            quantities={recipeState}
            readOnly={readOnly}
            onQuantityChange={(itemId, value) => {
              setRecipeError(null);
              setRecipeState((state) => ({ ...state, [itemId]: value }));
            }}
          />
        ) : (
          <div className="admin-catalog-inventory-usage__loading">
            {advancedLoadError ? (
              <p role="alert">Inventory usage could not be loaded. No recipe changes were saved.</p>
            ) : (
              <p>Loading authorized inventory definitions…</p>
            )}
            {advancedLoadError && onRequestAdvanced ? (
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => {
                  void onRequestAdvanced();
                }}
              >
                Retry inventory load
              </button>
            ) : null}
          </div>
        )}
        {recipeError ? (
          <p role="alert" className="admin-catalog-inventory-usage__error">
            {recipeError}
          </p>
        ) : null}
      </section>

      <button
        className="admin-disclosure-button"
        type="button"
        aria-expanded={advancedOpen}
        onClick={toggleAdvanced}
      >
        <span>More</span>
        <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
      </button>

      {advancedOpen ? (
        <div className="admin-catalog-editor__advanced" data-catalog-advanced>
          <section className="admin-catalog-editor__section is-compact">
            <h2>Extras / Modifiers</h2>
            {advancedModel ? (
              advancedModel.modifiers.length === 0 ? (
                <p className="admin-field__help">No modifiers are configured for this shop.</p>
              ) : (
                <div className="admin-catalog-advanced-list">
                  {advancedModel.modifiers.map((modifier) => {
                    const current = modifierState[modifier.id];
                    const linked = current?.linked ?? modifier.linked;
                    const maxQuantity =
                      current?.maxQuantity ??
                      (modifier.maxQuantity === null ? '' : String(modifier.maxQuantity));
                    return (
                      <div className="admin-catalog-advanced-row" key={modifier.id}>
                        <label className="admin-check-field">
                          <input
                            type="checkbox"
                            checked={linked}
                            disabled={readOnly || (!modifier.active && !linked)}
                            onChange={(event) =>
                              setModifierState((state) => ({
                                ...state,
                                [modifier.id]: {
                                  linked: event.currentTarget.checked,
                                  maxQuantity,
                                },
                              }))
                            }
                          />
                          <span>{modifier.name}</span>
                        </label>
                        <label className="admin-field">
                          <span>Max quantity</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            inputMode="numeric"
                            value={maxQuantity}
                            placeholder="No limit"
                            disabled={readOnly || !linked || !modifier.active}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setModifierState((state) => ({
                                ...state,
                                [modifier.id]: { linked, maxQuantity: value },
                              }));
                            }}
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <p className="admin-field__help">Loading editable catalog relationships…</p>
            )}
          </section>

          {comboEnabled ? (
            <section className="admin-catalog-editor__section is-compact">
              <h2>Combo Options</h2>
              {advancedModel ? (
                advancedModel.comboOptions.length === 0 ? (
                  <p className="admin-field__help">No products are available as combo options.</p>
                ) : (
                  <div className="admin-catalog-advanced-list">
                    {advancedModel.comboOptions.map((option) => {
                      const selected = comboState[option.productId] ?? option.selected;
                      return (
                        <label className="admin-check-field" key={option.productId}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={readOnly || (!option.active && !selected)}
                            onChange={(event) =>
                              setComboState((state) => ({
                                ...state,
                                [option.productId]: event.currentTarget.checked,
                              }))
                            }
                          />
                          <span>{option.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )
              ) : (
                <p className="admin-field__help">Loading combo options…</p>
              )}
            </section>
          ) : null}

          <section className="admin-catalog-editor__section is-compact">
            <h2>Shop Overrides</h2>
            <label className="admin-check-field">
              <input
                type="checkbox"
                checked={visible}
                disabled={readOnly}
                onChange={(event) => setVisible(event.currentTarget.checked)}
              />
              <span>Visible in this shop</span>
            </label>
            <p className="admin-field__help">
              Price is edited above for this shop. Sold-out state stays an immediate live control.
            </p>
          </section>

          <section className="admin-catalog-editor__section is-compact">
            <h2>History</h2>
            <p className="admin-field__help">
              Published releases stay in history. Restoring creates a new release.
            </p>
            <button
              className="admin-secondary-button admin-catalog-history-link"
              type="button"
              onClick={onReviewPublish}
            >
              Open version history
            </button>
          </section>
        </div>
      ) : null}

      <section className="admin-catalog-danger-zone" aria-label="Product danger zone">
        <div>
          <strong>Danger zone</strong>
          <p>Archiving is saved as a draft change. It is not live until catalog publication.</p>
        </div>
        {!archiveConfirmationOpen ? (
          <button
            className="admin-danger-link"
            type="button"
            disabled={readOnly || !product.active}
            onClick={() => setArchiveConfirmationOpen(true)}
          >
            Archive product
          </button>
        ) : (
          <div
            className="admin-catalog-danger-zone__confirm"
            role="group"
            aria-label="Confirm product archive"
          >
            <p>Archive {product.name} in the next catalog draft?</p>
            <button
              type="button"
              className="admin-danger-link"
              disabled={readOnly}
              onClick={() => void archiveProduct()}
            >
              Confirm archive draft
            </button>
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => setArchiveConfirmationOpen(false)}
            >
              Keep product
            </button>
          </div>
        )}
      </section>
      <footer className="admin-catalog-editor__actions">
        {onCancel ? (
          <button className="admin-secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button className="admin-primary-button" type="submit" disabled={readOnly}>
          Save draft
        </button>
      </footer>
    </form>
  );
}
