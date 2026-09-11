import { useState } from 'react';

import type { CatalogPublishPreview, CatalogScheduledChangeSummary } from '@tux/admin-contracts';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { ScheduleEditor } from './ScheduleEditor';
import { VersionHistory } from './VersionHistory';
import { CatalogUiError, useCatalogPublishing } from './useCatalog';
import './catalog.css';
import './publishing.css';

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof CatalogUiError) {
    if (error.code === 'stale_version') return 'The live catalog changed. Refresh before publishing.';
    if (error.code === 'scheduled_time_must_be_future') {
      return 'Choose a future activation time in Africa/Cairo.';
    }
    if (error.code === 'schedule_in_progress') {
      return 'This scheduled publish is already being executed and cannot be cancelled.';
    }
    return `Catalog action failed: ${error.code}`;
  }
  return 'Catalog action failed. Refresh and try again.';
}

function scheduleStatusLabel(schedule: CatalogScheduledChangeSummary): string {
  if (schedule.status === 'FAILED') return 'Retry queued';
  if (schedule.status === 'CLAIMED') return 'Executing';
  return schedule.status === 'PENDING' ? 'Pending' : schedule.status;
}

function PublishSummary({ preview }: { preview: CatalogPublishPreview }) {
  return (
    <section className="admin-publish-card admin-publish-summary" aria-labelledby="publish-summary-heading">
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Draft preview</p>
          <h2 id="publish-summary-heading">Change summary</h2>
        </div>
        <span className={`admin-status-pill${preview.stale ? ' is-warning' : ''}`}>
          {preview.stale ? 'Refresh required' : `Draft r${preview.draftRevision}`}
        </span>
      </div>
      <div className="admin-publish-metrics">
        <div>
          <strong>{countLabel(preview.changedProductIds.length, 'product changed', 'products changed')}</strong>
          <span>Canonical product fields that differ from live state.</span>
        </div>
        <div>
          <strong>{countLabel(preview.priceChangedProductIds.length, 'price change', 'price changes')}</strong>
          <span>Pricing changes require catalog.pricing at execution time.</span>
        </div>
      </div>
      <div className="admin-publish-version-line">
        <span>Draft base version {preview.basePublishVersion}</span>
        <span>Current catalog version {preview.currentPublishVersion}</span>
      </div>
    </section>
  );
}

export function PublishReviewPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const publishing = useCatalogPublishing(shopId);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<number | null>(null);

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Catalog"
        title="Review & publish"
        description="Select one shop before reviewing or changing its canonical catalog."
      >
        <div className="admin-callout is-warning">
          <div>
            <strong>Concrete shop required</strong>
            <span>Publishing, scheduling, and restores never run against All Shops.</span>
          </div>
        </div>
      </PageScaffold>
    );
  }

  const canPublish = principal.permissions.includes('catalog.publish');
  const data = publishing.publishingQuery.data;
  const preview = data?.draftPreviews[0];
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
    if (!preview) return;
    await runAction(async () => {
      const result = await publishing.publishDraft.mutateAsync({
        draftId: preview.draftId,
        expectedDraftRevision: preview.draftRevision,
        expectedVersion: preview.currentPublishVersion,
      });
      setNotice(`Published as version ${result.publishVersion}.`);
    });
  }

  async function schedulePublish(localScheduledAt: string) {
    if (!preview) return;
    await runAction(async () => {
      await publishing.scheduleDraft.mutateAsync({
        draftId: preview.draftId,
        expectedDraftRevision: preview.draftRevision,
        expectedVersion: preview.currentPublishVersion,
        localScheduledAt,
      });
      setNotice('Publish scheduled.');
    });
  }

  async function restoreVersion(sourcePublishVersion: number) {
    if (!data) return;
    setPendingRestoreVersion(sourcePublishVersion);
    await runAction(async () => {
      const result = await publishing.restoreVersion.mutateAsync({
        sourcePublishVersion,
        expectedVersion: data.currentPublishVersion,
      });
      setNotice(`Restored as version ${result.publishVersion}.`);
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
      description="Review trusted draft differences, publish immediately, schedule in Cairo time, or restore a historical version as a new version."
      primaryAction={
        <a className="admin-secondary-button admin-publish-back-link" href="/catalog/products">
          Back to products
        </a>
      }
    >
      {notice ? <div className="admin-callout"><strong>{notice}</strong></div> : null}
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
              <span className="admin-catalog-editor__eyebrow">Canonical state</span>
              <strong>Live version {data.currentPublishVersion}</strong>
            </div>
            <span className="admin-status-pill">Shop scoped</span>
          </div>

          {preview ? (
            <>
              {preview.stale ? (
                <div className="admin-callout is-warning">
                  <div>
                    <strong>Draft is based on an older live version</strong>
                    <span>Refresh/rebase the draft before publishing or scheduling it.</span>
                  </div>
                </div>
              ) : null}

              <PublishSummary preview={preview} />

              <section className="admin-publish-card" aria-labelledby="publish-now-heading">
                <div className="admin-publish-card__heading">
                  <div>
                    <p className="admin-catalog-editor__eyebrow">Immediate activation</p>
                    <h2 id="publish-now-heading">Publish now</h2>
                  </div>
                </div>
                <p className="admin-publish-card__copy">
                  Publishing creates a new immutable version and updates the canonical Operations
                  configuration. Browser state never becomes the source of truth.
                </p>
                <button
                  className="admin-primary-button"
                  type="button"
                  disabled={!canPublish || preview.stale || publishing.publishDraft.isPending}
                  onClick={() => void publishNow()}
                >
                  {publishing.publishDraft.isPending ? 'Publishing…' : 'Publish now'}
                </button>
              </section>

              <ScheduleEditor
                preview={preview}
                disabled={!canPublish}
                isPending={publishing.scheduleDraft.isPending}
                onSchedule={schedulePublish}
              />
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
                  <p className="admin-catalog-editor__eyebrow">Durable jobs</p>
                  <h2 id="scheduled-publishes-heading">Scheduled publishes</h2>
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
                      <span>Target base version {schedule.targetBasePublishVersion ?? '—'}</span>
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
