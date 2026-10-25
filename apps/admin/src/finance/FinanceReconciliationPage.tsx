import type { FinanceDayReport } from '@tux/admin-contracts';
import { useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { FinanceSectionNav } from './FinanceSectionNav';
import { formatEgp } from './money';
import { useFinanceOperations } from './useFinanceOperations';
import './finance.css';

export type FinanceReconciliationFactsModel = Pick<
  FinanceDayReport,
  'businessDayStatus' | 'paymentBreakdown' | 'cashierReconciliations'
>;

/**
 * Read-only facts from the existing authorized Finance day projection.
 * These payment totals are NOT physical method counts. Do not display an
 * actual/variance for a payment method until Operations owns and exposes one.
 */
export function FinanceReconciliationFacts({
  facts,
}: {
  facts: FinanceReconciliationFactsModel;
}) {
  return (
    <div className="tux-finance-reconciliation-facts">
      {facts.businessDayStatus !== 'CLOSED' ? (
        <p role="status">
          Awaiting Operations count. This Business Day remains open; no physical actual or
          variance has been verified.
        </p>
      ) : (
        <p role="status">
          Business Day closed. Payment totals below are recorded Finance facts, not verified
          Operations physical counts.
        </p>
      )}
      <section
        aria-label="Recorded payment method totals"
        className="tux-finance-reconciliation-section"
      >
        <h2>Recorded payments by method</h2>
        <div className="tux-finance-reconciliation-grid">
          {Object.entries(facts.paymentBreakdown).map(([method, expectedMinor]) => (
            <dl key={method} className="tux-finance-reconciliation-card">
              <dt>{method}</dt>
              <dd>Recorded: {formatEgp(expectedMinor)}</dd>
              <dd>Physical actual: Not available</dd>
              <dd>Physical variance: Not available</dd>
            </dl>
          ))}
        </div>
        {Object.keys(facts.paymentBreakdown).length === 0 ? (
          <EmptyState
            title="No recorded payment methods"
            description="No payment breakdown is available for the selected Business Day."
          />
        ) : null}
      </section>
      <section
        aria-label="Posted cashier reconciliations"
        className="tux-finance-reconciliation-section"
      >
        <h2>Finance-posted cashier reconciliation</h2>
        <p>
          Cashier reconciliations are Finance records. They do not constitute a method-by-method
          Operations physical-close record.
        </p>
        {facts.cashierReconciliations.length > 0 ? (
          <ul className="tux-finance-reconciliation-list">
            {facts.cashierReconciliations.map((record) => (
              <li key={record.cashierWorkerId}>
                <strong>Cashier {record.cashierWorkerId.slice(0, 8)}</strong>
                <span>Expected: {formatEgp(record.expectedMinor)}</span>
                <span>Actual: {formatEgp(record.actualMinor)}</span>
                <span>Variance: {formatEgp(record.varianceMinor)}</span>
                {record.reason ? <span>Reason: {record.reason}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p role="status">No Finance-posted cashier cash count is available for this day.</p>
        )}
      </section>
    </div>
  );
}

export function FinanceReconciliationPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [selectedDay, setSelectedDay] = useState('');
  const financeDays = useFinanceOperations(shopId, undefined, ['days']);
  const days = financeDays.daysQuery.data?.days ?? [];
  const activeDay = days.find((day) => day.id === selectedDay) ?? days[0];
  const reportQuery = useFinanceOperations(shopId, activeDay?.id, ['day']);
  const report = reportQuery.dayQuery.data;
  const authorizedReport =
    report && report.shopId === shopId && report.businessDayId === activeDay?.id
      ? report
      : null;

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Finance"
        title="Reconciliation"
        description="Select one authorized shop to review its recorded Business Day."
      />
    );
  }

  return (
    <PageScaffold
      eyebrow="Finance"
      title="Reconciliation"
      description="Read-only review. Physical counting and Business Day closure remain owned by Operations."
    >
      <FinanceSectionNav
        active="reconciliation"
        canReconcile={principal.permissions.includes('finance.reconcile')}
      />
      {financeDays.daysQuery.isLoading ? <LoadingState title="Loading Business Days" /> : null}
      {financeDays.daysQuery.isError ? (
        <ErrorState
          title="Business Days unavailable"
          action={
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => void financeDays.daysQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {!financeDays.daysQuery.isLoading && !financeDays.daysQuery.isError && days.length === 0 ? (
        <EmptyState
          title="No Business Day recorded"
          description="Start a Business Day in Operations to make recorded financial facts available."
        />
      ) : null}
      {days.length > 0 && activeDay ? (
        <label className="tux-finance-day-picker">
          Business Day
          <select
            value={activeDay.id}
            onChange={(event) => setSelectedDay(event.currentTarget.value)}
          >
            {days.map((day) => (
              <option key={day.id} value={day.id}>
                {new Date(day.started_at).toLocaleString('en-EG', {
                  timeZone: 'Africa/Cairo',
                })}{' '}
                · {day.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {activeDay && reportQuery.dayQuery.isLoading ? (
        <LoadingState title="Loading recorded reconciliation facts" />
      ) : null}
      {activeDay && reportQuery.dayQuery.isError ? (
        <ErrorState
          title="Reconciliation facts unavailable"
          action={
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => void reportQuery.dayQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {authorizedReport ? <FinanceReconciliationFacts facts={authorizedReport} /> : null}
      {activeDay &&
      !authorizedReport &&
      !reportQuery.dayQuery.isLoading &&
      !reportQuery.dayQuery.isError ? (
        <EmptyState
          title="No verified reconciliation facts"
          description="The selected Business Day has no authorized financial report available."
        />
      ) : null}
    </PageScaffold>
  );
}
