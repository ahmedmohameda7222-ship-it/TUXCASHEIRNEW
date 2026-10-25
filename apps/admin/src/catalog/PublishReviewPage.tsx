import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';

import type { CatalogPublishPreview, CatalogScheduledChangeSummary } from '@tux/admin-contracts';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CatalogCopyPanel } from './CatalogCopyPanel';
import { PublishReviewChanges } from './PublishReviewChanges';
import { publishReviewIdentity } from './publishReviewIdentity';
import { VersionHistory } from './VersionHistory';
import { CatalogUiError, useCatalogPublishing } from './useCatalog';
import './catalog.css';
import './publishing.css';

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof CatalogUiError) {
    if (error.code === 'stale_version')
      return 'The live catalog changed. Refresh before publishing.';
    if (error.code === 'stale_rule_version') {
      return 'This recurring rule changed. Refresh before editing it again.';
    }
    if (error.code === 'recurring_rule_conflict') {
      return 'This recurring window overlaps another active rule for the same product.';
    }
    if (error.code === 'scheduled_time_must_be_future') {
      return 'Choose a future activation time in Africa/Cairo.';
    }
    if (error.code === 'schedule_in_progress') {
      return 'This scheduled publish is already being executed and cannot be cancelled.';
    }
    return 'We could not complete that catalog action. Refresh and try again.';
  }
  return 'Catalog action failed. Refresh and try again.';
}

function scheduleStatusLabel(schedule: CatalogScheduledChangeSummary): string {
  if (schedule.status === 'FAILED' && schedule.terminalFailure) return 'Failed — action required';
  if (schedule.status === 'FAILED') return 'Failed — no automatic retry';
  if (schedule.status === 'CLAIMED') return 'Claimed (not verified)';
  return schedule.status === 'PENDING' ? 'Pending — not automatic' : schedule.status;
}

function PublishSummary({ preview }: { preview: CatalogPublishPreview }) {
  return (
    <section
      className="admin-publish-card admin-publish-summary"
      aria-labelledby="publish-summary-heading"
    >
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Release preview</p>
          <h2 id="publish-summary-heading">Change summary</h2>
        </div>
        <span className={`admin-status-pill${preview.stale ? ' is-warning' : ''}`}>
          {preview.stale ? 'Refresh required' : 'Ready to publish'}
        </span>
      </div>
      <div className="admin-publish-metrics">
        <div>
          <strong>
            {countLabel(preview.changedProductIds.length, 'product changed', 'products changed')}
          </strong>
          <span>Products with changes waiting to go live.</span>
        </div>
        <div>
          <strong>
            {countLabel(preview.priceChangedProductIds.length, 'price change', 'price changes')}
          </strong>
          <span>Products whose customer price will change.</span>
        </div>
        <div>
          <strong>
            {countLabel(
              preview.changedRelationCounts.productModifierLinks,
              'extras setup changed',
              'extras setups changed',
            )}
          </strong>
          <span>Products with changes to available extras.</span>
        </div>
        <div>
          <strong>
            {countLabel(
              preview.changedRelationCounts.comboBeverageOptions,
              'combo option changed',
              'combo options changed',
            )}
          </strong>
          <span>Combos with changes to their drink choices.</span>
        </div>
        <div>
          <strong>
            {countLabel(
              preview.changedRelationCounts.recipeLines,
              'recipe line changed',
              'recipe lines changed',
            )}
          </strong>
          <span>Products with recipe quantity changes.</span>
        </div>
      </div>
    </section>
  );
}

export function PublishReviewPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const publishing = useCatalogPublishing(shopId);
  const [notice, setNotice] = useState<string | null>(null);
  const [requesterPin, setRequesterPin] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<number | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [confirmedPreviewIdentity, setConfirmedPreviewIdentity] = useState<string | null>(null);
  const selectedDraftRef = useRef<string | null>(null);
  const shopRef = useRef(shopId);

  useEffect(() => {
    setSelectedDraftId(null);
    setConfirmedPreviewIdentity(null);
    setRequesterPin('');
    setNotice(null);
    setActionError(null);
  }, [shopId]);

  const canPublish = principal.permissions.includes('catalog.publish');
  const canEditCatalog = principal.permissions.includes('catalog.edit');
  const data = publishing.publishingQuery.data;
  const draftPreviews = data?.draftPreviews ?? [];
  // Select the first available draft only on initial load. If an already selected
  // draft disappears, never silently select a different draft for publication.
  const preview =
    selectedDraftId === null
      ? draftPreviews[0]
      : draftPreviews.find((candidate) => candidate.draftId === selectedDraftId);
  const reviewedIdentity =
    preview && shopId && data?.shopId === shopId
      ? publishReviewIdentity(shopId, preview)
      : null;
  const confirmedPublish =
    reviewedIdentity !== null &&
    confirmedPreviewIdentity === reviewedIdentity &&
    !publishing.publishingQuery.isFetching &&
    !publishing.publishingQuery.isError;

  selectedDraftRef.current = selectedDraftId ?? preview?.draftId ?? null;
  shopRef.current = shopId;

  useEffect(() => {
    if (!data || selectedDraftId !== null) return;
    setSelectedDraftId(data.draftPreviews[0]?.draftId ?? '');
  }, [data, selectedDraftId]);

  useEffect(() => {
    setConfirmedPreviewIdentity(null);
    setRequesterPin('');
  }, [reviewedIdentity]);
  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Catalog"
        title="Review & publish"
        description="Select one shop before reviewing or changing its catalog."
      >
        <div className="admin-callout is-warning">
          <div>
            <strong>Select a shop</strong>
            <span>Publishing and restores never run against All Shops.</span>
          </div>
        </div>
      </PageScaffold>
    );
  }

  const schedules = (data?.schedules ?? []).filter((schedule) =>
    new Set(['PENDING', 'FAILED', 'CLAIMED']).has(schedule.status),
  );

  async function runAction(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  async function publishNow() {
    if (!preview || preview.shopId !== shopId || !confirmedPublish || !reviewedIdentity) return;
    // Never use a revision read after the operator's explicit confirmation.
    const selectedAtConfirmation = selectedDraftRef.current;
    const shopAtConfirmation = shopRef.current;
    const confirmed = {
      shopId,
      draftId: preview.draftId,
      expectedDraftRevision: preview.draftRevision,
      expectedVersion: preview.currentPublishVersion,
      previewIdentity: reviewedIdentity,
      requesterPin: requesterPin.trim(),
    };
    await runAction(async () => {
      // A background refetch alone cannot close the confirmation-to-click race.
      // Explicitly revalidate the exact reviewed preview immediately before POST.
      const refreshed = await publishing.publishingQuery.refetch();
      const current = refreshed.data;
      const sameDraft = current?.draftPreviews.find(
        (candidate) => candidate.draftId === confirmed.draftId,
      );
      if (
        refreshed.isError ||
        !current ||
        current.shopId !== confirmed.shopId ||
        current.currentPublishVersion !== confirmed.expectedVersion ||
        shopRef.current !== shopAtConfirmation ||
        selectedDraftRef.current !== selectedAtConfirmation ||
        !sameDraft ||
        sameDraft.stale ||
        publishReviewIdentity(confirmed.shopId, sameDraft) !== confirmed.previewIdentity
      ) {
        setConfirmedPreviewIdentity(null);
        setRequesterPin('');
        setActionError('The reviewed draft changed. Review the updated changes and confirm again.');
        return;
      }
      const result = await publishing.publishDraft.mutateAsync({
        draftId: confirmed.draftId,
        expectedDraftRevision: confirmed.expectedDraftRevision,
        expectedVersion: confirmed.expectedVersion,
        ...(confirmed.requesterPin ? { requesterPin: confirmed.requesterPin } : {}),
      });
      setRequesterPin('');
      setConfirmedPreviewIdentity(null);
      if ('state' in result && result.state === 'PENDING_APPROVAL') {
        setNotice(
          'Catalog publication requested. A second person must approve before it goes live.',
        );
      } else if ('idempotentReplay' in result && result.idempotentReplay) {
        setNotice('Catalog publication already processed. Refresh to inspect the live version.');
      } else {
        setNotice('Catalog published.');
      }
    });
  }

  async function restoreVersion(sourcePublishVersion: number) {
    if (!data) return;
    setPendingRestoreVersion(sourcePublishVersion);
    await runAction(async () => {
      await publishing.restoreVersion.mutateAsync({
        sourcePublishVersion,
        expectedVersion: data.currentPublishVersion,
      });
      setNotice('The selected catalog version was restored and published.');
    });
    setPendingRestoreVersion(null);
  }

  async function cancelSchedule(scheduleId: string) {
    await runAction(async () => {
      await publishing.cancelSchedule.mutateAsync(scheduleId);
      setNotice('Scheduled publish cancelled.');
    });
  }

  return (
    <PageScaffold
      eyebrow="Catalog"
      title="Review & publish"
      description="Review catalog changes, publish now through the authorized workflow, or restore an earlier release."
      primaryAction={
        <Link className="admin-secondary-button admin-publish-back-link" href="/catalog/products">
          Back to products
        </Link>
      }
    >
      {notice ? (
        <div className="admin-callout">
          <strong>{notice}</strong>
        </div>
      ) : null}
      {actionError ? (
        <div className="admin-callout is-danger" role="alert">
          <strong>{actionError}</strong>
        </div>
      ) : null}

      {publishing.publishingQuery.isLoading ? (
        <div className="admin-catalog-loading">Loading publish state…</div>
      ) : null}
      {publishing.publishingQuery.isError ? (
        <div className="admin-callout is-danger" role="alert">
          <strong>Publish state unavailable</strong>
          <span>Refresh before making catalog release decisions.</span>
        </div>
      ) : null}

      {data ? (
        <div className="admin-publish-page">
          <div className="admin-publish-live-bar">
            <div>
              <span className="admin-catalog-editor__eyebrow">Catalog status</span>
              <strong>
                {principal.shopSummaries?.find((shop) => shop.id === shopId)?.name ??
                  'Selected shop'}
              </strong>
              <small>Live catalog · publish version {data.currentPublishVersion}</small>
            </div>
            <span className="admin-status-pill">Shop scoped</span>
          </div>

          {canEditCatalog ? (
            <CatalogCopyPanel
              targetShopId={shopId}
              targetPublishVersion={data.currentPublishVersion}
              draft={
                preview ? { draftId: preview.draftId, draftRevision: preview.draftRevision } : null
              }
              sourceShopIds={principal.shopIds.filter((id) => id !== shopId)}
              canPrice={principal.permissions.includes('catalog.pricing')}
            />
          ) : null}

          <div className="admin-callout is-warning" role="status">
            <strong>Automatic scheduling is unavailable</strong>
            <span>
              Schedule Publish and recurring availability are disabled because there is no verified
              unattended runner. Existing schedules and saved rules are preserved for review, but
              they will not execute automatically. Use Publish now or immediate manual availability
              controls instead.
            </span>
          </div>

          {draftPreviews.length > 1 || (selectedDraftId !== null && !preview) ? (
            <label className="admin-field">
              <span>Changes to review</span>
              <select
                aria-label="Changes to review"
                value={preview?.draftId ?? ''}
                onChange={(event) => {
                  setSelectedDraftId(event.target.value);
                  setConfirmedPreviewIdentity(null);
                  setRequesterPin('');
                }}
              >
                {!preview ? <option value="">Select saved changes to review</option> : null}
                {draftPreviews.map((candidate, index) => (
                  <option key={candidate.draftId} value={candidate.draftId}>
                    Saved changes {index + 1}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {preview ? (
            <>
              {preview.stale ? (
                <div className="admin-callout is-warning">
                  <div>
                    <strong>These changes need to be refreshed</strong>
                    <span>
                      The live catalog changed after this work was saved. Refresh before publishing.
                    </span>
                  </div>
                </div>
              ) : null}

              <PublishSummary preview={preview} />
              {preview.changes ? <PublishReviewChanges changes={preview.changes} /> : null}

              <section className="admin-publish-card" aria-labelledby="publish-now-heading">
                <div className="admin-publish-card__heading">
                  <div>
                    <p className="admin-catalog-editor__eyebrow">Immediate activation</p>
                    <h2 id="publish-now-heading">Publish now</h2>
                  </div>
                </div>
                <p className="admin-publish-card__copy">
                  Publish reviewed draft changes for{' '}
                  {principal.shopSummaries?.find((shop) => shop.id === shopId)?.name ?? 'this shop'}
                  . This action checks the current published version {preview.currentPublishVersion}
                  , may require second-person approval, and is separate from immediate sold-out
                  controls.
                </p>
                <label className="admin-field">
                  <span>Requester PIN (when required by approval policy)</span>
                  <input
                    type="password"
                    autoComplete="off"
                    maxLength={64}
                    value={requesterPin}
                    disabled={!canPublish || publishing.publishDraft.isPending}
                    onChange={(event) => setRequesterPin(event.currentTarget.value)}
                  />
                </label>
                <label className="admin-field">
                  <span>
                    <input
                      type="checkbox"
                      checked={confirmedPublish}
                      disabled={
                        !canPublish ||
                        preview.stale ||
                        publishing.publishDraft.isPending ||
                        publishing.publishingQuery.isFetching
                      }
                      onChange={(event) =>
                        setConfirmedPreviewIdentity(
                          event.currentTarget.checked ? reviewedIdentity : null,
                        )
                      }
                    />{' '}
                    I reviewed the changes and confirm publication for this shop.
                  </span>
                </label>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={
                    !canPublish ||
                    !confirmedPublish ||
                    preview.stale ||
                    publishing.publishDraft.isPending ||
                    publishing.publishingQuery.isFetching
                  }
                  onClick={() => void publishNow()}
                >
                  {publishing.publishDraft.isPending ? 'Publishing…' : 'Publish now'}
                </button>
              </section>
            </>
          ) : (
            <div className="admin-empty-state">
              <strong>No draft ready for review</strong>
              <span>Create and save catalog changes before publishing.</span>
            </div>
          )}

          {schedules.length > 0 ? (
            <section className="admin-publish-card" aria-labelledby="scheduled-publishes-heading">
              <div className="admin-publish-card__heading">
                <div>
                  <p className="admin-catalog-editor__eyebrow">Preserved history</p>
                  <h2 id="scheduled-publishes-heading">Existing schedules</h2>
                </div>
              </div>
              <div className="admin-publish-history">
                {schedules.map((schedule) => (
                  <article className="admin-publish-history__row" key={schedule.id}>
                    <div className="admin-publish-history__main">
                      <div className="admin-publish-history__title">
                        <strong>{schedule.localScheduledAt}</strong>
                        <span className="admin-status-pill">{scheduleStatusLabel(schedule)}</span>
                      </div>
                      <span>Cairo timezone</span>
                      {schedule.status === 'FAILED' ? (
                        <span>
                          This publish was not completed. Review the draft and publish manually.
                        </span>
                      ) : null}
                    </div>
                    <button
                      className="admin-danger-link"
                      type="button"
                      disabled={
                        !canPublish ||
                        schedule.status === 'CLAIMED' ||
                        publishing.cancelSchedule.isPending
                      }
                      onClick={() => void cancelSchedule(schedule.id)}
                    >
                      Cancel scheduled publish
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <VersionHistory
            versions={data.versions}
            currentPublishVersion={data.currentPublishVersion}
            canRestore={canPublish}
            pendingVersion={pendingRestoreVersion}
            onRestore={restoreVersion}
          />
        </div>
      ) : null}
    </PageScaffold>
  );
}
