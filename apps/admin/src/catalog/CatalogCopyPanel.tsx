import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type Domain = 'productPrices' | 'productAvailability' | 'categoryOrder' | 'categoryAvailability';

type CopyPreview = {
  ok: true;
  mappedProducts: number;
  changedProducts: number;
  mappedCategories: number;
  changedCategories: number;
  categoryDifferences: Array<{
    targetCategoryId: string;
    categoryName: string;
    sortOrderBefore: number;
    sortOrderAfter: number;
    activeBefore: boolean;
    activeAfter: boolean;
  }>;
  fingerprint: string;
  expectedSourcePublishVersion: number;
  expectedTargetPublishVersion: number;
  expectedTargetDraftRevision: number;
  selectedDomains: Domain[];
  differences: Array<{
    targetProductId: string;
    productName: string;
    priceBeforeMinor: number;
    priceAfterMinor: number;
    activeBefore: boolean;
    activeAfter: boolean;
    soldOutBefore: boolean;
    soldOutAfter: boolean;
  }>;
};

export function CatalogCopyPanel({
  targetShopId,
  targetPublishVersion,
  draft,
  sourceShopIds,
  canPrice,
}: {
  targetShopId: string;
  targetPublishVersion: number;
  draft: { draftId: string; draftRevision: number } | null;
  sourceShopIds: readonly string[];
  canPrice: boolean;
}) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [sourceShopId, setSourceShopId] = useState(sourceShopIds[0] ?? '');
  const [domains, setDomains] = useState<Domain[]>(['productAvailability']);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [commandId, setCommandId] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setPreview(null);
    setCommandId('');
    setMessage('');
  }

  function toggle(domain: Domain, checked: boolean) {
    setDomains((current) =>
      checked ? [...current, domain] : current.filter((item) => item !== domain),
    );
    reset();
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !sourceShopId || pending || domains.length === 0) return;
    if (session.state.status !== 'authenticated') return;
    setPending(true);
    setError('');
    reset();
    try {
      const source = await adminFetch<{ currentPublishVersion: number }>(
        `/api/admin/catalog?shopId=${encodeURIComponent(sourceShopId)}&view=publishing`,
      );
      if (source.currentPublishVersion < 1) {
        throw new Error('Source shop has no published catalog.');
      }
      const result = await adminFetch<CopyPreview>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'catalog-copy.preview',
            sourceShopId,
            targetShopId,
            targetDraftId: draft.draftId,
            expectedSourcePublishVersion: source.currentPublishVersion,
            expectedTargetPublishVersion: targetPublishVersion,
            expectedTargetDraftRevision: draft.draftRevision,
            selectedDomains: domains,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error('Catalog preview could not be verified.');
      setPreview(result);
      setCommandId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Catalog preview failed.');
    } finally {
      setPending(false);
    }
  }

  async function stageCopy() {
    if (!draft || !preview || !commandId || pending) return;
    if (session.state.status !== 'authenticated') return;
    setPending(true);
    setError('');
    try {
      const result = await adminFetch<{ ok: boolean; code?: string; draftRevision?: number }>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'catalog-copy.apply',
            sourceShopId,
            targetShopId,
            targetDraftId: draft.draftId,
            expectedSourcePublishVersion: preview.expectedSourcePublishVersion,
            expectedTargetPublishVersion: preview.expectedTargetPublishVersion,
            expectedTargetDraftRevision: preview.expectedTargetDraftRevision,
            selectedDomains: preview.selectedDomains,
            previewFingerprint: preview.fingerprint,
            commandId,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code ?? 'catalog_copy_failed');
      setMessage('Copy staged in the target draft. Review the changes and publish separately.');
      setPreview(null);
      setCommandId('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', targetShopId] });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Copy not applied: ${cause.message}. Refresh both shops and preview again.`
          : 'Catalog copy failed.',
      );
      setPreview(null);
    } finally {
      setPending(false);
    }
  }

  if (sourceShopIds.length === 0) return null;
  return (
    <section className="admin-publish-card" aria-labelledby="catalog-copy-title">
      <h2 id="catalog-copy-title">Selective catalog copy</h2>
      <p className="admin-publish-card__copy">
        Copy product prices and availability from the published source catalog into this shop's
        unpublished draft. Products and categories must already share canonical business master mappings in both
        shops. Only explicitly selected fields transfer; missing entities, modifiers,
        recipes and historical data are not copied.
      </p>
      {draft ? (
        <form onSubmit={(event) => void makePreview(event)}>
          <label className="admin-field">
            <span>Source shop</span>
            <select
              value={sourceShopId}
              disabled={pending}
              onChange={(event) => {
                setSourceShopId(event.currentTarget.value);
                reset();
              }}
            >
              {sourceShopIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <p>Target shop: {targetShopId}</p>
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('productAvailability')}
              disabled={pending}
              onChange={(event) => toggle('productAvailability', event.currentTarget.checked)}
            />
            Product availability
          </label>
          {canPrice ? (
            <label className="admin-field">
              <input
                type="checkbox"
                checked={domains.includes('productPrices')}
                disabled={pending}
                onChange={(event) => toggle('productPrices', event.currentTarget.checked)}
              />
              Product prices
            </label>
          ) : null}
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('categoryOrder')}
              disabled={pending}
              onChange={(event) => toggle('categoryOrder', event.currentTarget.checked)}
            />
            Category display order (mapped categories only)
          </label>
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('categoryAvailability')}
              disabled={pending}
              onChange={(event) => toggle('categoryAvailability', event.currentTarget.checked)}
            />
            Category availability (mapped categories only)
          </label>
          <button
            type="submit"
            className="admin-secondary-button"
            disabled={pending || domains.length === 0}
          >
            {pending ? 'Checking…' : 'Preview catalog copy'}
          </button>
        </form>
      ) : (
        <p>Create an authorized catalog draft for this shop before copying.</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {preview ? (
        <div role="status">
          <p>
            Read-only preview: {preview.mappedProducts} existing master-mapped products,
            {preview.changedProducts} target products would change; {preview.mappedCategories} mapped
            categories, {preview.changedCategories} target categories would change.
          </p>
          {preview.differences.length > 0 ? (
            <ul>
              {preview.differences.map((item) => (
                <li key={item.targetProductId}>
                  <strong>{item.productName}</strong>
                  {domains.includes('productPrices') ? (
                    <span>
                      {' '}
                      Price: {item.priceBeforeMinor} → {item.priceAfterMinor} minor units.
                    </span>
                  ) : null}
                  {domains.includes('productAvailability') ? (
                    <span>
                      {' '}
                      Active: {String(item.activeBefore)} → {String(item.activeAfter)}, sold out:{' '}
                      {String(item.soldOutBefore)} → {String(item.soldOutAfter)}.
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.categoryDifferences.length > 0 ? (
            <ul>
              {preview.categoryDifferences.map((item) => (
                <li key={item.targetCategoryId}>
                  <strong>{item.categoryName}</strong>
                  {domains.includes('categoryOrder') ? (
                    <span> Order: {item.sortOrderBefore} → {item.sortOrderAfter}.</span>
                  ) : null}
                  {domains.includes('categoryAvailability') ? (
                    <span>
                      {' '}Active: {String(item.activeBefore)} → {String(item.activeAfter)}.
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            Source publication {preview.expectedSourcePublishVersion}, target publication{' '}
            {preview.expectedTargetPublishVersion}, draft revision{' '}
            {preview.expectedTargetDraftRevision}. Both are revalidated transactionally.
          </p>
          <button
            type="button"
            className="admin-primary-button"
            disabled={pending || (preview.changedProducts === 0 && preview.changedCategories === 0)}
            onClick={() => void stageCopy()}
          >
            {pending ? 'Applying…' : 'Apply to target draft'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
