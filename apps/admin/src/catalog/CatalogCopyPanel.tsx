import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { catalogCopyErrorMessage } from './catalogCopyFeedback';
import { catalogCopyPreviewMatchesSelection } from './catalogCopyPreviewGuard';

type Domain =
  | 'productPrices'
  | 'productAvailability'
  | 'productOrder'
  | 'categoryOrder'
  | 'categoryAvailability'
  | 'productCategoryAssignments'
  | 'comboBeverageOptions'
  | 'productModifierLinks'
  | 'modifierDefinitions'
  | 'recipeLines';

type CopyPreview = {
  ok: true;
  sourceShopId: string;
  targetShopId: string;
  targetDraftId: string;
  mappedProducts: number;
  changedProducts: number;
  mappedCategories: number;
  changedCategories: number;
  mappedComboBeverageOptions: number;
  changedComboBeverageOptions: number;
  mappedProductModifierLinks: number;
  changedProductModifierLinks: number;
  mappedModifierDefinitions: number;
  changedModifierDefinitions: number;
  mappedRecipeLines: number;
  changedRecipeLines: number;
  recipeDifferences: Array<{
    targetProductId: string;
    targetInventoryItemId: string;
    quantityBeforeMicros: number | null;
    quantityAfterMicros: number | null;
  }>;
  modifierDefinitionDifferences: Array<{
    targetModifierId: string;
    nameBefore: string;
    nameAfter: string;
    priceBeforeMinor: number;
    priceAfterMinor: number;
    activeBefore: boolean;
    activeAfter: boolean;
    sortOrderBefore: number;
    sortOrderAfter: number;
  }>;
  productModifierLinkDifferences: Array<{
    targetProductId: string;
    targetModifierId: string;
    maxQuantityBefore: number | null;
    maxQuantityAfter: number | null;
    sortOrderBefore: number | null;
    sortOrderAfter: number | null;
  }>;
  comboDifferences: Array<{
    targetComboProductId: string;
    targetBeverageProductId: string;
    sortOrderBefore: number | null;
    sortOrderAfter: number | null;
  }>;
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
    sortOrderBefore: number;
    sortOrderAfter: number;
    categoryIdBefore: string;
    categoryIdAfter: string;
    priceBeforeMinor: number;
    priceAfterMinor: number;
    activeBefore: boolean;
    activeAfter: boolean;
    soldOutBefore: boolean;
    soldOutAfter: boolean;
  }>;
};

type MissingEntityPreview = {
  ok: true;
  sourceShopId: string;
  targetShopId: string;
  targetDraftId: string;
  expectedSourcePublishVersion: number;
  expectedTargetPublishVersion: number;
  expectedTargetDraftRevision: number;
  creationFingerprint: string;
  missingCategories: number;
  missingProducts: number;
  conflicts: number;
  allCategoriesAndProductsMapped: boolean;
  categories: Array<{
    sourceCategoryId: string;
    sourceName: string;
    targetCategoryId: string | null;
    masterCategoryId: string | null;
    proposedTargetCategoryId: string | null;
    status: string;
  }>;
  products: Array<{
    sourceProductId: string;
    sourceName: string;
    targetProductId: string | null;
    masterProductId: string | null;
    proposedTargetProductId: string | null;
    proposedTargetCategoryId: string | null;
    status: string;
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
  const canCopyRecipe =
    session.state.status === 'authenticated' &&
    session.state.session.principal.permissions.includes('inventory.view') &&
    session.state.session.principal.permissions.includes('inventory.adjust');
  const [sourceShopId, setSourceShopId] = useState(sourceShopIds[0] ?? '');
  const activeSourceShopId = sourceShopIds.includes(sourceShopId)
    ? sourceShopId
    : (sourceShopIds[0] ?? '');
  const [domains, setDomains] = useState<Domain[]>(['productAvailability']);
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [missingPreview, setMissingPreview] = useState<MissingEntityPreview | null>(null);
  const [selectedMissingCategories, setSelectedMissingCategories] = useState<string[]>([]);
  const [selectedMissingProducts, setSelectedMissingProducts] = useState<string[]>([]);
  const [missingCreationCommandId, setMissingCreationCommandId] = useState('');
  const [commandId, setCommandId] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const currentPreview = catalogCopyPreviewMatchesSelection(preview, {
    sourceShopId: activeSourceShopId,
    targetShopId,
    targetDraftId: draft?.draftId ?? null,
    targetPublishVersion,
    targetDraftRevision: draft?.draftRevision ?? null,
    selectedDomains: domains,
  })
    ? preview
    : null;

  const currentMissingPreview =
    missingPreview?.sourceShopId === activeSourceShopId &&
    missingPreview.targetShopId === targetShopId &&
    missingPreview.targetDraftId === draft?.draftId &&
    missingPreview.expectedTargetPublishVersion === targetPublishVersion &&
    missingPreview.expectedTargetDraftRevision === draft?.draftRevision
      ? missingPreview
      : null;

  function reset() {
    setMissingPreview(null);
    setSelectedMissingCategories([]);
    setSelectedMissingProducts([]);
    setMissingCreationCommandId('');
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

  async function createTargetDraft() {
    if (draft || pending || session.state.status !== 'authenticated') return;
    setPending(true);
    setError('');
    reset();
    try {
      const result = await adminFetch<{ ok: boolean; code?: string }>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'draft.create',
            shopId: targetShopId,
            expectedVersion: targetPublishVersion,
            title: 'Selective catalog copy',
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code ?? 'catalog_draft_create_failed');
      setMessage('Target draft created. Preview selected configuration before applying.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', targetShopId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create target draft.');
    } finally {
      setPending(false);
    }
  }

  async function inspectMissingEntities() {
    if (!draft || !activeSourceShopId || pending) return;
    if (session.state.status !== 'authenticated') return;
    setPending(true);
    setError('');
    reset();
    try {
      const source = await adminFetch<{ currentPublishVersion: number }>(
        `/api/admin/catalog?shopId=${encodeURIComponent(activeSourceShopId)}&view=publishing`,
      );
      if (source.currentPublishVersion < 1) {
        throw new Error('Source shop has no published catalog.');
      }
      const result = await adminFetch<MissingEntityPreview>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'catalog-copy.missing-preview',
            sourceShopId: activeSourceShopId,
            targetShopId,
            targetDraftId: draft.draftId,
            expectedSourcePublishVersion: source.currentPublishVersion,
            expectedTargetPublishVersion: targetPublishVersion,
            expectedTargetDraftRevision: draft.draftRevision,
          }),
        },
        session.state.session.csrfToken,
      );
      if (
        result.ok !== true ||
        result.sourceShopId !== activeSourceShopId ||
        result.targetShopId !== targetShopId ||
        result.targetDraftId !== draft.draftId ||
        result.expectedSourcePublishVersion !== source.currentPublishVersion ||
        result.expectedTargetPublishVersion !== targetPublishVersion ||
        result.expectedTargetDraftRevision !== draft.draftRevision ||
        !/^[0-9a-f]{64}$/.test(result.creationFingerprint) ||
        !Array.isArray(result.categories) ||
        !Array.isArray(result.products)
      ) {
        throw new Error('Catalog entity mapping report could not be verified.');
      }
      setMissingPreview(result);
      setMissingCreationCommandId(crypto.randomUUID());
    } catch (cause) {
      setError(catalogCopyErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  function toggleMissingEntity(kind: 'category' | 'product', id: string, checked: boolean) {
    const change = (current: string[]) =>
      checked ? [...current, id] : current.filter((item) => item !== id);
    if (kind === 'category') {
      setSelectedMissingCategories(change);
    } else {
      setSelectedMissingProducts(change);
    }
    setMissingCreationCommandId(crypto.randomUUID());
  }

  async function stageMissingEntities() {
    if (
      !draft ||
      !currentMissingPreview ||
      !missingCreationCommandId ||
      pending ||
      selectedMissingCategories.length + selectedMissingProducts.length === 0 ||
      (selectedMissingProducts.length > 0 && !canPrice) ||
      session.state.status !== 'authenticated'
    ) {
      return;
    }
    setPending(true);
    setError('');
    try {
      const result = await adminFetch<{ ok: boolean; code?: string; draftRevision?: number }>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'catalog-copy.stage-created-entities',
            sourceShopId: activeSourceShopId,
            targetShopId,
            targetDraftId: draft.draftId,
            expectedSourcePublishVersion: currentMissingPreview.expectedSourcePublishVersion,
            expectedTargetPublishVersion: currentMissingPreview.expectedTargetPublishVersion,
            expectedTargetDraftRevision: currentMissingPreview.expectedTargetDraftRevision,
            selectedSourceCategoryIds: selectedMissingCategories,
            selectedSourceProductIds: selectedMissingProducts,
            creationFingerprint: currentMissingPreview.creationFingerprint,
            commandId: missingCreationCommandId,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok || typeof result.draftRevision !== 'number') {
        throw new Error(result.code ?? 'catalog_copy_creation_failed');
      }
      reset();
      setMessage('New Catalog entities staged in target draft. Review and publish separately.');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', targetShopId] });
    } catch (cause) {
      setError(`Creation not staged: ${catalogCopyErrorMessage(cause)}`);
    } finally {
      setPending(false);
    }
  }

  async function makePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !activeSourceShopId || pending || domains.length === 0) return;
    if (session.state.status !== 'authenticated') return;
    setPending(true);
    setError('');
    reset();
    try {
      const source = await adminFetch<{ currentPublishVersion: number }>(
        `/api/admin/catalog?shopId=${encodeURIComponent(activeSourceShopId)}&view=publishing`,
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
            sourceShopId: activeSourceShopId,
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
      if (
        !result.ok ||
        result.expectedSourcePublishVersion !== source.currentPublishVersion ||
        !catalogCopyPreviewMatchesSelection(result, {
          sourceShopId: activeSourceShopId,
          targetShopId,
          targetDraftId: draft.draftId,
          targetPublishVersion,
          targetDraftRevision: draft.draftRevision,
          selectedDomains: domains,
        })
      ) {
        throw new Error('Catalog preview could not be verified.');
      }
      setPreview(result);
      setCommandId(crypto.randomUUID());
    } catch (cause) {
      setError(catalogCopyErrorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  async function stageCopy() {
    if (!draft || !currentPreview || !commandId || pending) return;
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
            sourceShopId: activeSourceShopId,
            targetShopId,
            targetDraftId: draft.draftId,
            expectedSourcePublishVersion: currentPreview.expectedSourcePublishVersion,
            expectedTargetPublishVersion: currentPreview.expectedTargetPublishVersion,
            expectedTargetDraftRevision: currentPreview.expectedTargetDraftRevision,
            selectedDomains: currentPreview.selectedDomains,
            previewFingerprint: currentPreview.fingerprint,
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
      setError(`Copy not applied: ${catalogCopyErrorMessage(cause)}`);
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
        {'Copy selected fields into the target catalog draft. '}
        {'Products and categories require canonical business master mappings. '}
        {'Product modifier links require mapped standalone products. '}
        {'Missing target categories or products are not yet copied. '}
        {'Mapped modifier definitions and compatible recipe lines can be copied. '}
        {'Historical sales and inventory balances are never copied.'}
      </p>
      {draft ? (
        <form onSubmit={(event) => void makePreview(event)}>
          <label className="admin-field">
            <span>Source shop</span>
            <select
              value={activeSourceShopId}
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
              checked={domains.includes('productCategoryAssignments')}
              disabled={pending}
              onChange={(event) =>
                toggle('productCategoryAssignments', event.currentTarget.checked)
              }
            />
            Product category assignments (mapped products and categories)
          </label>
          {canCopyRecipe ? (
            <label className="admin-field">
              <input
                type="checkbox"
                checked={domains.includes('recipeLines')}
                disabled={pending}
                onChange={(event) => toggle('recipeLines', event.currentTarget.checked)}
              />
              {'Recipe quantities (explicit inventory masters and matching base units)'}
            </label>
          ) : null}
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('comboBeverageOptions')}
              disabled={pending}
              onChange={(event) => toggle('comboBeverageOptions', event.currentTarget.checked)}
            />
            Combo beverage options (mapped products only)
          </label>
          {canPrice ? (
            <label className="admin-field">
              <input
                type="checkbox"
                checked={domains.includes('modifierDefinitions')}
                disabled={pending}
                onChange={(event) => toggle('modifierDefinitions', event.currentTarget.checked)}
              />
              Modifier definitions (mapped names, prices, active status and order)
            </label>
          ) : null}
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('productModifierLinks')}
              disabled={pending}
              onChange={(event) => toggle('productModifierLinks', event.currentTarget.checked)}
            />
            Product modifier links (mapped standalone products only)
          </label>
          <label className="admin-field">
            <input
              type="checkbox"
              checked={domains.includes('productOrder')}
              disabled={pending}
              onChange={(event) => toggle('productOrder', event.currentTarget.checked)}
            />
            Product display order (mapped products only)
          </label>
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
            type="button"
            className="admin-secondary-button"
            disabled={pending}
            onClick={() => void inspectMissingEntities()}
          >
            {pending ? 'Checking…' : 'Inspect target master mappings'}
          </button>
          <button
            type="submit"
            className="admin-secondary-button"
            disabled={pending || domains.length === 0}
          >
            {pending ? 'Checking…' : 'Preview catalog copy'}
          </button>
        </form>
      ) : (
        <div>
          <p>Create an authorized catalog draft for this shop before copying.</p>
          <button
            type="button"
            className="admin-secondary-button"
            disabled={pending}
            onClick={() => void createTargetDraft()}
          >
            {pending ? 'Creating draft…' : 'Create target draft for copy'}
          </button>
        </div>
      )}
      {currentMissingPreview ? (
        <section aria-label="Catalog master mapping report" role="status">
          <p>
            Read-only master identity report: {currentMissingPreview.missingCategories} missing
            categories, {currentMissingPreview.missingProducts} missing products, and{' '}
            {currentMissingPreview.conflicts} mapping conflicts.
          </p>
          <p>
            {currentMissingPreview.allCategoriesAndProductsMapped
              ? 'All source categories and products have mapped target-local identities.'
              : 'Select only genuinely missing entities. The target draft is staged first; separate publication is required. Conflicts and unsupported modifiers, combos or recipes must be resolved explicitly.'}
          </p>
          <ul>
            {currentMissingPreview.categories
              .filter((category) => category.status !== 'MAPPED')
              .map((category) => (
                <li key={category.sourceCategoryId}>
                  {category.status === 'CREATE_REQUIRED' && category.proposedTargetCategoryId ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedMissingCategories.includes(category.sourceCategoryId)}
                        disabled={pending}
                        onChange={(event) =>
                          toggleMissingEntity(
                            'category',
                            category.sourceCategoryId,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      Create Category: {category.sourceName}
                    </label>
                  ) : (
                    <span>
                      Category: {category.sourceName} — {category.status}
                    </span>
                  )}
                </li>
              ))}
            {currentMissingPreview.products
              .filter((product) => product.status !== 'MAPPED')
              .map((product) => (
                <li key={product.sourceProductId}>
                  {['CREATE_REQUIRED', 'MISSING_TARGET_CATEGORY'].includes(product.status) &&
                  product.proposedTargetProductId ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedMissingProducts.includes(product.sourceProductId)}
                        disabled={pending || !canPrice}
                        onChange={(event) =>
                          toggleMissingEntity(
                            'product',
                            product.sourceProductId,
                            event.currentTarget.checked,
                          )
                        }
                      />
                      Create Product: {product.sourceName}
                      {product.status === 'MISSING_TARGET_CATEGORY'
                        ? ' (requires selecting its Category)'
                        : ''}
                    </label>
                  ) : (
                    <span>
                      Product: {product.sourceName} — {product.status}
                    </span>
                  )}
                </li>
              ))}
          </ul>
          <button
            type="button"
            className="admin-secondary-button"
            disabled={
              pending ||
              !missingCreationCommandId ||
              selectedMissingCategories.length + selectedMissingProducts.length === 0 ||
              (selectedMissingProducts.length > 0 && !canPrice)
            }
            onClick={() => void stageMissingEntities()}
          >
            {pending ? 'Staging…' : 'Stage selected new entities in target draft'}
          </button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {currentPreview ? (
        <div role="status">
          <p>
            Read-only preview: {currentPreview.mappedProducts} existing master-mapped products,
            {currentPreview.changedProducts} target products would change;{' '}
            {currentPreview.mappedCategories} mapped categories, {currentPreview.changedCategories}{' '}
            target categories would change; {currentPreview.mappedComboBeverageOptions} combo
            beverage options mapped, {currentPreview.changedComboBeverageOptions} option changes.
          </p>
          <p>
            {currentPreview.mappedProductModifierLinks} mapped modifier links,{' '}
            {currentPreview.changedProductModifierLinks} link changes.
          </p>
          <p>
            {currentPreview.mappedModifierDefinitions} mapped modifier definitions,{' '}
            {currentPreview.changedModifierDefinitions} definition changes.
          </p>
          <p>
            {currentPreview.mappedRecipeLines} mapped recipe lines,{' '}
            {currentPreview.changedRecipeLines} recipe changes.
          </p>
          {currentPreview.differences.length > 0 ? (
            <ul>
              {currentPreview.differences.map((item) => (
                <li key={item.targetProductId}>
                  <strong>{item.productName}</strong>
                  {domains.includes('productOrder') ? (
                    <span>
                      {' '}
                      Order: {item.sortOrderBefore} → {item.sortOrderAfter}.
                    </span>
                  ) : null}
                  {domains.includes('productCategoryAssignments') ? (
                    <span>
                      {' '}
                      Category: {item.categoryIdBefore} → {item.categoryIdAfter}.
                    </span>
                  ) : null}
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
          {currentPreview.categoryDifferences.length > 0 ? (
            <ul>
              {currentPreview.categoryDifferences.map((item) => (
                <li key={item.targetCategoryId}>
                  <strong>{item.categoryName}</strong>
                  {domains.includes('categoryOrder') ? (
                    <span>
                      {' '}
                      Order: {item.sortOrderBefore} → {item.sortOrderAfter}.
                    </span>
                  ) : null}
                  {domains.includes('categoryAvailability') ? (
                    <span>
                      {' '}
                      Active: {String(item.activeBefore)} → {String(item.activeAfter)}.
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {currentPreview.comboDifferences.length > 0 ? (
            <ul>
              {currentPreview.comboDifferences.map((item) => (
                <li key={`${item.targetComboProductId}:${item.targetBeverageProductId}`}>
                  <strong>Combo {item.targetComboProductId}</strong> — beverage{' '}
                  {item.targetBeverageProductId}; order {item.sortOrderBefore ?? 'none'} →{' '}
                  {item.sortOrderAfter ?? 'removed'}.
                </li>
              ))}
            </ul>
          ) : null}
          {currentPreview.productModifierLinkDifferences.length > 0 ? (
            <ul>
              {currentPreview.productModifierLinkDifferences.map((item) => (
                <li key={`${item.targetProductId}:${item.targetModifierId}`}>
                  <strong>Product {item.targetProductId}</strong>
                  {' — modifier '}
                  {item.targetModifierId}
                  {'; max quantity '}
                  {item.maxQuantityBefore ?? 'none'} → {item.maxQuantityAfter ?? 'removed'}
                  {'; order '}
                  {item.sortOrderBefore ?? 'none'} → {item.sortOrderAfter ?? 'removed'}.
                </li>
              ))}
            </ul>
          ) : null}
          {currentPreview.modifierDefinitionDifferences.length > 0 ? (
            <ul>
              {currentPreview.modifierDefinitionDifferences.map((item) => (
                <li key={item.targetModifierId}>
                  <strong>Modifier {item.targetModifierId}</strong>
                  {' — name: '}
                  {item.nameBefore} → {item.nameAfter}
                  {'; price: '}
                  {item.priceBeforeMinor} → {item.priceAfterMinor}
                  {'; active: '}
                  {String(item.activeBefore)} → {String(item.activeAfter)}
                  {'; order: '}
                  {item.sortOrderBefore} → {item.sortOrderAfter}.
                </li>
              ))}
            </ul>
          ) : null}
          {currentPreview.recipeDifferences.length > 0 ? (
            <ul>
              {currentPreview.recipeDifferences.map((item) => (
                <li key={`${item.targetProductId}:${item.targetInventoryItemId}`}>
                  <strong>{item.targetProductId}</strong>
                  <span>{item.targetInventoryItemId}</span>
                  <span>{item.quantityBeforeMicros ?? 'none'}</span>
                  <span>→</span>
                  <span>{item.quantityAfterMicros ?? 'removed'}</span>
                  <span>base micros</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            Source publication {currentPreview.expectedSourcePublishVersion}, target publication{' '}
            {currentPreview.expectedTargetPublishVersion}, draft revision{' '}
            {currentPreview.expectedTargetDraftRevision}. Both are revalidated transactionally.
          </p>
          <button
            type="button"
            className="admin-primary-button"
            disabled={
              pending ||
              (currentPreview.changedProducts === 0 &&
                currentPreview.changedCategories === 0 &&
                currentPreview.changedComboBeverageOptions === 0 &&
                currentPreview.changedProductModifierLinks === 0 &&
                currentPreview.changedModifierDefinitions === 0 &&
                currentPreview.changedRecipeLines === 0)
            }
            onClick={() => void stageCopy()}
          >
            {pending ? 'Applying…' : 'Apply to target draft'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
