import { useState } from 'react';

import { InlineError } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { parseEgpMinor, formatEgp } from '../finance/money';

import { REPORT_LABELS } from './ReportFilters';
import type {
  ReportConfigDraft,
  ReportFilters,
  SavedReportViewRow,
  ReportTargetRow,
} from './useReports';

export function SavedViews({
  shopId,
  views,
  targets,
  filters,
  canSetTargets,
  pending,
  error,
  onCommand,
  onApply,
}: {
  shopId: string;
  views: readonly SavedReportViewRow[];
  targets: readonly ReportTargetRow[];
  filters: ReportFilters;
  canSetTargets: boolean;
  pending: boolean;
  error: unknown;
  onCommand(draft: ReportConfigDraft): void;
  onApply(view: SavedReportViewRow): void;
}) {
  const [showSave, setShowSave] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [name, setName] = useState('');
  const [targetMetric, setTargetMetric] = useState<ReportTargetRow['metric']>('NET_SALES');
  const [targetAmount, setTargetAmount] = useState('0.00');
  const [targetStart, setTargetStart] = useState(filters.fromDate);
  const [targetEnd, setTargetEnd] = useState(filters.toDate);
  const [localError, setLocalError] = useState<string | null>(null);

  function saveView() {
    if (!name.trim()) {
      setLocalError('Enter a view name.');
      return;
    }
    onCommand({
      type: 'report.view.save',
      shopId,
      id: null,
      expectedVersion: 0,
      name: name.trim(),
      reportArea: filters.area,
      filters: {
        area: filters.area,
        fromDate: filters.fromDate,
        toDate: filters.toDate,
        source: filters.source,
        shopIds: filters.shopIds,
        comparePrevious: filters.comparePrevious,
        comparisonRange: filters.comparisonRange ?? 'previous',
        context: filters.context ?? {},
      },
      layout: {},
    });
    setShowSave(false);
    setName('');
    setLocalError(null);
  }
  function saveTarget() {
    try {
      const targetValue =
        targetMetric === 'NET_SALES' || targetMetric === 'WASTE'
          ? parseEgpMinor(targetAmount)
          : targetMetric === 'FOOD_COST_PERCENT'
            ? Math.round(Number(targetAmount) * 100)
            : Number(targetAmount);
      if (
        !Number.isSafeInteger(targetValue) ||
        targetValue < 0 ||
        (targetMetric === 'FOOD_COST_PERCENT' && targetValue > 10000)
      ) {
        throw new Error('Enter a valid nonnegative target.');
      }
      const existing = targets.find(
        (target) =>
          target.metric === targetMetric &&
          target.periodStart === targetStart &&
          target.periodEnd === targetEnd,
      );
      onCommand({
        type: 'report.target.set',
        shopId,
        metric: targetMetric,
        periodStart: targetStart,
        periodEnd: targetEnd,
        targetValue,
        expectedVersion: existing?.version ?? 0,
      });
      setShowTarget(false);
      setLocalError(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Invalid target amount');
    }
  }

  return (
    <section className="tux-reports-config" aria-label="Saved reports and targets">
      <div className="tux-reports-config__actions">
        <button className="admin-secondary-button" type="button" onClick={() => setShowSave(true)}>
          Save this report view
        </button>
        {canSetTargets ? (
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => setShowTarget(true)}
          >
            Set target
          </button>
        ) : null}
      </div>
      {error ? (
        <InlineError>
          {error instanceof Error ? error.message : 'Unable to update report settings'}
        </InlineError>
      ) : null}
      <h2>Saved views</h2>
      {views.length === 0 ? (
        <p>No saved report views yet.</p>
      ) : (
        <ul className="tux-reports-saved">
          {views.map((view) => (
            <li key={view.id}>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => onApply(view)}
              >
                {view.name} · {REPORT_LABELS[view.reportArea]}
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pending}
                aria-label={`Delete view ${view.name}`}
                onClick={() =>
                  onCommand({
                    type: 'report.view.delete',
                    shopId,
                    id: view.id,
                    expectedVersion: view.version,
                  })
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>Targets</h2>
      {targets.length === 0 ? (
        <p>No targets configured.</p>
      ) : (
        <ul className="tux-reports-saved">
          {targets.map((target) => (
            <li key={target.id}>
              <span>
                {target.metric.replaceAll('_', ' ')} · {target.periodStart}–{target.periodEnd}
              </span>
              <strong>
                {target.metric === 'NET_SALES' || target.metric === 'WASTE'
                  ? formatEgp(target.targetValue)
                  : target.metric === 'FOOD_COST_PERCENT'
                    ? `${(target.targetValue / 100).toLocaleString('en-EG', { maximumFractionDigits: 2 })}%`
                    : target.targetValue.toLocaleString('en-EG')}
              </strong>
            </li>
          ))}
        </ul>
      )}

      <AdminDialog
        open={showSave}
        title="Save report view"
        description="Save current report filters for this Admin account."
        onOpenChange={setShowSave}
        footer={
          <>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setShowSave(false)}
            >
              Cancel
            </button>
            <button
              className="admin-primary-button"
              type="button"
              disabled={pending}
              onClick={saveView}
            >
              Save view
            </button>
          </>
        }
      >
        <label className="tux-report-dialog-label">
          View name
          <input maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {localError ? <InlineError>{localError}</InlineError> : null}
      </AdminDialog>
      <AdminDialog
        open={showTarget}
        title="Configure report target"
        description="Targets are tracked per shop and period."
        onOpenChange={setShowTarget}
        footer={
          <>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setShowTarget(false)}
            >
              Cancel
            </button>
            <button
              className="admin-primary-button"
              type="button"
              disabled={pending}
              onClick={saveTarget}
            >
              Save target
            </button>
          </>
        }
      >
        <div className="tux-report-target-form">
          <label>
            Metric
            <select
              value={targetMetric}
              onChange={(e) => setTargetMetric(e.target.value as ReportTargetRow['metric'])}
            >
              <option value="NET_SALES">Net sales (EGP)</option>
              <option value="ORDER_COUNT">Order count</option>
              <option value="FOOD_COST_PERCENT">Food cost percentage (%)</option>
              <option value="WASTE">Waste cost (EGP)</option>
            </select>
          </label>
          <label>
            From{' '}
            <input
              type="date"
              value={targetStart}
              onChange={(e) => setTargetStart(e.target.value)}
            />
          </label>
          <label>
            To{' '}
            <input type="date" value={targetEnd} onChange={(e) => setTargetEnd(e.target.value)} />
          </label>
          <label>
            Value{' '}
            <input
              inputMode="decimal"
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
            />
          </label>
          {localError ? <InlineError>{localError}</InlineError> : null}
        </div>
      </AdminDialog>
    </section>
  );
}
