import type { CatalogCategorySummary, CatalogProductDetail } from '@tux/admin-contracts';
import { useMemo, useState, type FormEvent } from 'react';

import {
  previewCatalogBulkEdit,
  type CatalogBulkPatch,
  type CatalogBulkPreviewRow,
} from './catalogBulkEdit';
import { formatEgpMinor, parseEgpToMinor } from './ProductEditor';

type Mode =
  | 'price.fixed'
  | 'price.adjust'
  | 'price.percentage'
  | 'category.assign'
  | 'archive'
  | 'restore'
  | 'bestSeller.enable'
  | 'bestSeller.disable'
  | 'sortOrder.adjust';

function signedMinor(value: string): number {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value.trim()))
    throw new Error('Enter an exact EGP amount with at most two decimal places.');
  const minor = Number(value) * 100;
  if (!Number.isSafeInteger(Math.round(minor))) throw new Error('Price adjustment is too large.');
  return Math.round(minor);
}

function formatChange(row: CatalogBulkPreviewRow, patch: CatalogBulkPatch): string {
  const { before, after } = row;
  switch (patch.kind) {
    case 'price.fixed':
    case 'price.adjust':
    case 'price.percentage':
      return `EGP ${formatEgpMinor(before.priceMinor)} → EGP ${formatEgpMinor(after.priceMinor)}`;
    case 'category.assign':
      return `${before.categoryId} → ${after.categoryId}`;
    case 'archive':
      return `${before.active ? 'Active' : 'Archived'} → ${after.active ? 'Active' : 'Archived'}`;
    case 'bestSeller':
      return `${before.bestSeller ? 'Best seller' : 'Regular'} → ${after.bestSeller ? 'Best seller' : 'Regular'}`;
    case 'sortOrder.adjust':
      return `Position ${before.sortOrder} → ${after.sortOrder}`;
  }
}

export function BulkProductEditor({
  shopId,
  products,
  categories,
  canEdit,
  canPrice,
  busy,
  onSave,
}: {
  shopId: string;
  products: readonly CatalogProductDetail[];
  categories: readonly CatalogCategorySummary[];
  canEdit: boolean;
  canPrice: boolean;
  busy: boolean;
  onSave(input: {
    selectedIds: string[];
    patch: CatalogBulkPatch;
    expectedBefore: CatalogProductDetail[];
  }): Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('archive');
  const [value, setValue] = useState('');
  const [targetCategoryId, setTargetCategoryId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scopedProducts = products.filter((product) => product.shopId === shopId);
  const activeCategories = categories.filter(
    (category) => category.shopId === shopId && category.active,
  );

  const result = useMemo((): {
    patch: CatalogBulkPatch | null;
    preview: CatalogBulkPreviewRow[];
    message: string | null;
  } => {
    if (selectedIds.length === 0) {
      return { patch: null, preview: [], message: 'Select products to preview a bulk edit.' };
    }
    try {
      let patch: CatalogBulkPatch;
      switch (mode) {
        case 'price.fixed':
          patch = { kind: mode, priceMinor: parseEgpToMinor(value) };
          break;
        case 'price.adjust':
          patch = { kind: mode, deltaMinor: signedMinor(value) };
          break;
        case 'price.percentage':
          patch = { kind: mode, percentage: Number(value) };
          if (!value.trim()) throw new Error('Enter a percentage.');
          break;
        case 'category.assign':
          patch = { kind: mode, categoryId: targetCategoryId };
          break;
        case 'archive':
        case 'restore':
          patch = { kind: 'archive', archived: mode === 'archive' };
          break;
        case 'bestSeller.enable':
        case 'bestSeller.disable':
          patch = { kind: 'bestSeller', enabled: mode === 'bestSeller.enable' };
          break;
        case 'sortOrder.adjust':
          patch = { kind: mode, delta: Number(value) };
          if (!value.trim()) throw new Error('Enter a sort-order change.');
          break;
      }
      return {
        patch,
        preview: previewCatalogBulkEdit(scopedProducts, shopId, selectedIds, patch, categories),
        message: null,
      };
    } catch (cause) {
      return {
        patch: null,
        preview: [],
        message: cause instanceof Error ? cause.message : 'Invalid bulk edit.',
      };
    }
  }, [categories, mode, scopedProducts, selectedIds, shopId, targetCategoryId, value]);

  function toggleProduct(productId: string, checked: boolean) {
    setSelectedIds((current) =>
      checked ? [...current, productId] : current.filter((id) => id !== productId),
    );
    setConfirmed(false);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || busy || saving || !confirmed || !result.patch || !result.preview.length) return;
    if (mode.startsWith('price.') && !canPrice) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        selectedIds,
        patch: result.patch,
        expectedBefore: result.preview.map(({ before }) => before),
      });
      setSelectedIds([]);
      setConfirmed(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Bulk draft save failed. Your selection has been preserved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="admin-publish-card"
      aria-label="Bulk edit products"
      onSubmit={(event) => void submit(event)}
    >
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Shop-scoped draft</p>
          <h2>Bulk edit products</h2>
        </div>
        <span className="admin-status-pill">{selectedIds.length} selected</span>
      </div>
      <p className="admin-publish-card__copy">
        Select up to 100 products. The entire batch is validated and saved as one draft revision.
        Nothing goes live until Review & Publish and any required approval. Live sold-out changes
        are intentionally separate from draft edits.
      </p>
      <div className="admin-catalog-bulk-selection" aria-label="Select products">
        {scopedProducts.map((product) => (
          <label className="admin-catalog-bulk-selection__item" key={product.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(product.id)}
              disabled={
                !canEdit ||
                busy ||
                saving ||
                (selectedIds.length >= 100 && !selectedIds.includes(product.id))
              }
              onChange={(event) => toggleProduct(product.id, event.currentTarget.checked)}
            />
            <span>{product.name}</span>
            <small>EGP {formatEgpMinor(product.priceMinor)}</small>
          </label>
        ))}
      </div>
      <div className="admin-settings-grid">
        <label className="admin-field">
          <span>Action</span>
          <select
            value={mode}
            disabled={!canEdit || busy || saving}
            onChange={(event) => {
              setMode(event.currentTarget.value as Mode);
              setConfirmed(false);
            }}
          >
            <option value="price.fixed" disabled={!canPrice}>
              Set price
            </option>
            <option value="price.adjust" disabled={!canPrice}>
              Adjust price (EGP)
            </option>
            <option value="price.percentage" disabled={!canPrice}>
              Adjust price (%)
            </option>
            <option value="category.assign">Move to category</option>
            <option value="archive">Archive selected</option>
            <option value="restore">Restore selected</option>
            <option value="bestSeller.enable">Mark best sellers</option>
            <option value="bestSeller.disable">Remove best-seller flag</option>
            <option value="sortOrder.adjust">Shift sort order</option>
          </select>
        </label>
        {mode === 'category.assign' ? (
          <label className="admin-field">
            <span>Target category</span>
            <select
              value={targetCategoryId}
              disabled={!canEdit || busy || saving}
              onChange={(event) => {
                setTargetCategoryId(event.currentTarget.value);
                setConfirmed(false);
              }}
            >
              <option value="">Select a category</option>
              {activeCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        ) : mode.startsWith('price.') || mode === 'sortOrder.adjust' ? (
          <label className="admin-field">
            <span>
              {mode === 'price.percentage'
                ? 'Percentage'
                : mode === 'sortOrder.adjust'
                  ? 'Position change'
                  : 'EGP amount'}
            </span>
            <input
              type="text"
              inputMode={mode === 'sortOrder.adjust' ? 'numeric' : 'decimal'}
              value={value}
              disabled={!canEdit || busy || saving || (mode.startsWith('price.') && !canPrice)}
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setConfirmed(false);
              }}
            />
          </label>
        ) : null}
      </div>
      {result.message ? (
        <p role="status">{result.message}</p>
      ) : (
        <div className="admin-publish-history">
          <strong>Before → After preview</strong>
          {result.preview.map(({ before, after }) => (
            <div className="admin-publish-history__row" key={before.id}>
              <strong>{before.name}</strong>
              <span>{formatChange({ before, after }, result.patch!)}</span>
            </div>
          ))}
        </div>
      )}
      <label className="admin-field">
        <span>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!canEdit || busy || saving || !result.patch}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />{' '}
          I reviewed all selected products and their proposed changes.
        </span>
      </label>
      <button
        className="admin-primary-button"
        type="submit"
        disabled={
          !canEdit ||
          busy ||
          saving ||
          !confirmed ||
          !result.patch ||
          (mode.startsWith('price.') && !canPrice)
        }
      >
        {saving ? 'Saving batch…' : 'Save bulk draft'}
      </button>
      {error ? (
        <div className="admin-callout is-danger" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  );
}
