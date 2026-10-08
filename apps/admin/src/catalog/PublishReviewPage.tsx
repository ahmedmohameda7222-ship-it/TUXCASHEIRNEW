import { useState } from 'react';
import { Link } from 'wouter';

import type {
  CatalogPublishPreview,
  CatalogSaveRecurringAvailabilityRuleInput,
  CatalogScheduledChangeSummary,
} from '@tux/admin-contracts';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { RecurringAvailabilityEditor } from './RecurringAvailabilityEditor';
import { ScheduleEditor } from './ScheduleEditor';
import { VersionHistory } from './VersionHistory';
import { CatalogUiError, useCatalogPublishing } from './useCatalog';
import { useRecurringAvailability } from './useRecurringAvailability';
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
  if (schedule.status === 'FAILED') return 'Retry queued';
  if (schedule.status === 'CLAIMED') return 'Executing';
  return schedule.status === 'PENDING' ? 'Pending' : schedule.status;
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
  const recurring = useRecurringAvailability(shopId);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<number | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

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
            <span>Publishing, scheduling, and restores never run against All Shops.</span>
          </div>
        </div>
      </PageScaffold>
    );
  }

  const canPublish = principal.permissions.includes('catalog.publish');
  const canEditCatalog = principal.permissions.includes('catalog.edit');
  const data = publishing.publishingQuery.data;
  const draftPreviews = data?.draftPreviews ?? [];
  const preview =
    draftPreviews.find((candidate) => candidate.draftId === selectedDraftId) ?? draftPreviews[0];
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
      await publishing.publishDraft.mutateAsync({
        draftId: preview.draftId,
        expectedDraftRevision: preview.draftRevision,
        expectedVersion: preview.currentPublishVersion,
      });
      setNotice('Catalog published.');
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

  async function saveRecurringAvailability(
    input: Omit<CatalogSaveRecurringAvailabilityRuleInput, 'shopId'>,
  ) {
    await runAction(async () => {
      await recurring.saveRule.mutateAsync(input);
      setNotice('Recurring availability saved.');
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
      description="Review catalog changes, publish now, schedule a Cairo activation time, or restore an earlier release."
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
              <strong>Live</strong>
            </div>
            <span className="admin-status-pill">Shop scoped</span>
          </div>

          <RecurringAvailabilityEditor
            workspace={recurring.recurringQuery.data}
            isLoading={recurring.recurringQuery.isLoading}
            isError={recurring.recurringQuery.isError}
            disabled={!canEditCatalog}
            isPending={recurring.saveRule.isPending}
            onSave={saveRecurringAvailability}
          />

          {draftPreviews.length > 1 ? (
            <label className="admin-field">
              <span>Changes to review</span>
              <select
                aria-label="Changes to review"
                value={preview?.draftId ?? ''}
                onChange={(event) => setSelectedDraftId(event.target.value)}
              >
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

              <section className="admin-publish-card" aria-labelledby="publish-now-heading">
                <div className="admin-publish-card__heading">
                  <div>
                    <p className="admin-catalog-editor__eyebrow">Immediate activation</p>
                    <h2 id="publish-now-heading">Publish now</h2>
                  </div>
                </div>
                <p className="admin-publish-card__copy">
                  Make these reviewed changes visible to customers and Operations.
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
                  <p className="admin-catalog-editor__eyebrow">Upcoming</p>
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
                      {schedule.status === 'FAILED' ? (
                        <span>
                          We could not complete this publish. Review the changes and schedule it
                          again.
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
