import { useState } from 'react';
import { Link, useSearch } from 'wouter';

import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
} from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CashierReconciliation } from './CashierReconciliation';
import { EndDayHistoryPage } from './EndDayHistoryPage';
import { formatEgp } from './money';
import { useFinanceOperations } from './useFinanceOperations';

function amount(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Not available' : formatEgp(value);
}
export function EndDayPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const search = useSearch();
  const requestedDay = new URLSearchParams(search).get('businessDayId');
  const [cashierOpen, setCashierOpen] = useState(false);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [pin, setPin] = useState('');
  const operations = useFinanceOperations(shopId, undefined, ['days']);
  const days = operations.daysQuery.data?.days ?? [];
  const dayId =
    selectedDay ??
    (requestedDay && /^[0-9a-f-]{36}$/i.test(requestedDay) ? requestedDay : undefined) ??
    days[0]?.id;
  const detail = useFinanceOperations(shopId, dayId, ['day', 'cashiers']);
  const report = detail.dayQuery.data;
  const cashierNames = new Map(
    (detail.cashierQuery.data?.workers ?? []).map((w) => [w.id, w.display_name]),
  );
  const canReconcile = principal.permissions.includes('finance.reconcile');
  const canAdjust = principal.permissions.includes('finance.adjust');

  const blockReasons = report
    ? [
        report.businessDayStatus !== 'CLOSED'
          ? 'Operations must close this Business Day first.'
          : null,
        report.financialFinalized ? 'Financial Z already finalized.' : null,
        report.missingCashierReconciliationCount > 0
          ? `${report.missingCashierReconciliationCount} cashier count(s) still require review.`
          : null,
        report.missingInventoryCostCount > 0
          ? `${report.missingInventoryCostCount} inventory cost event(s) have no verified cost.`
          : null,
        report.unattributedPaymentCount > 0
          ? `${report.unattributedPaymentCount} payment(s) lack original finance attribution.`
          : null,
      ].filter((item): item is string => item !== null)
    : [];
  const canFinalize = canReconcile && blockReasons.length === 0 && Boolean(report);

  function finalize() {
    if (!shopId || !dayId) return;
    if (!/^\d{4,12}$/.test(pin)) return;
    detail.command.mutate(
      {
        draft: {
          type: 'finance.day.finalize',
          shopId,
          businessDayId: dayId,
        },
        reauthPin: pin,
      },
      {
        onSuccess: () => {
          setFinalizeOpen(false);
          setPin('');
        },
      },
    );
  }

  if (!shopId)
    return (
      <PageScaffold
        eyebrow="Finance"
        title="End Day"
        description="Select a shop to view X reports and financial Z history."
      />
    );

  return (
    <PageScaffold
      eyebrow="Finance"
      title="X Report / Financial End Day"
      description="X is always read-only. Operations closes the Business Day; Admin only reconciles and finalizes financial Z afterward."
    >
      <nav className="tux-finance-toolbar" aria-label="Finance sections">
        <Link className="admin-secondary-button" href="/finance">
          Bank & Cash
        </Link>
        <Link className="admin-secondary-button" href="/finance/expenses">
          Expenses
        </Link>
        <Link className="admin-secondary-button" href="/finance/settlements">
          Settlements
        </Link>
      </nav>
      {operations.daysQuery.isLoading ? <LoadingState title="Loading business days" /> : null}
      {operations.daysQuery.isError ? (
        <ErrorState
          title="Cannot load business days"
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void operations.daysQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {days.length === 0 && !operations.daysQuery.isLoading && !operations.daysQuery.isError ? (
        <EmptyState
          title="No business day recorded"
          description="An Operations Business Day is required for an X report."
        />
      ) : null}
      {days.length > 0 ? (
        <label className="tux-finance-day-picker">
          Business Day
          <select value={dayId ?? ''} onChange={(e) => setSelectedDay(e.target.value)}>
            {days.map((day) => (
              <option value={day.id} key={day.id}>
                {new Date(day.started_at).toLocaleString('en-EG', { timeZone: 'Africa/Cairo' })}
                {' · '}
                {day.status}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {detail.dayQuery.isLoading ? <LoadingState title="Building non-closing X report" /> : null}
      {detail.dayQuery.isError ? (
        <ErrorState
          title="X report unavailable"
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void detail.dayQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {report ? (
        <section className="tux-finance-x-report" aria-label="Non-closing X report">
          <div className="tux-finance-x-report__heading">
            <h2>Non-closing X report</h2>
            <strong>{report.businessDayStatus}</strong>
          </div>
          <p>This report does not close or modify the Operations Business Day.</p>
          <dl className="tux-finance-x-grid">
            {[
              ['Orders', report.orderCount.toLocaleString('en-EG')],
              ['Net sales', amount(report.netSalesMinor)],
              ['Posted refunds', amount(report.postedRefundsMinor)],
              ['Cash sales net', amount(report.cashSalesNetMinor)],
              ['Expenses including staff pay', amount(report.totalExpensesMinor)],
              ['COGS', amount(report.cogsMinor)],
              ['Estimated operating profit', amount(report.estimatedOperatingProfitMinor)],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>Cash and treasury movements</h3>
          <dl className="tux-finance-x-grid">
            {[
              ['Opening float', report.openingFloatMinor],
              ['Pay in', report.cashPayInsMinor],
              ['Pay out', report.cashPayOutsMinor],
              ['Cash expenses', report.cashExpensesMinor],
              ['Bank deposits', report.bankDepositsMinor],
              ['Transfers out', report.transfersOutMinor],
              ['Transfers in', report.transfersInMinor],
              ['Closing cash', report.closingCashMinor],
              ['Closing bank', report.closingBankMinor],
              ['Closing wallet', report.closingWalletMinor],
              ['Pending settlement', report.closingPendingSettlementMinor],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{amount(typeof value === 'number' ? value : null)}</dd>
              </div>
            ))}
          </dl>
          <h3>Payment breakdown</h3>
          <dl className="tux-finance-x-grid">
            {Object.entries(report.paymentBreakdown).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{amount(value)}</dd>
              </div>
            ))}
          </dl>
          <h3>Cashier counts</h3>
          {report.cashierReconciliations.length === 0 ? (
            <p>No cashier reconciliation has been posted for this day.</p>
          ) : (
            <ul className="tux-finance-ledger-list">
              {report.cashierReconciliations.map((entry) => (
                <li key={entry.cashierWorkerId}>
                  <div>
                    <strong>{cashierNames.get(entry.cashierWorkerId) ?? 'Cashier'}</strong>
                    <small>
                      Expected: {amount(entry.expectedMinor)} · Actual: {amount(entry.actualMinor)}
                    </small>
                  </div>
                  <strong>{amount(entry.varianceMinor)}</strong>
                </li>
              ))}
            </ul>
          )}
          {blockReasons.length > 0 ? (
            <div className="tux-finance-attention" role="status">
              <strong>Financial finalization conditions</strong>
              <ul>
                {blockReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {canReconcile && report.businessDayStatus === 'CLOSED' && !report.financialFinalized ? (
            <div className="tux-finance-toolbar">
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => setCashierOpen(true)}
              >
                Record cashier count
              </button>
              <button
                className="admin-primary-button"
                type="button"
                disabled={!canFinalize}
                onClick={() => setFinalizeOpen(true)}
              >
                Finalize financial Z
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <EndDayHistoryPage shopId={shopId} canAdjust={canAdjust} />
      {dayId ? (
        <CashierReconciliation
          shopId={shopId}
          businessDayId={dayId}
          open={cashierOpen}
          onClose={() => setCashierOpen(false)}
        />
      ) : null}
      <AdminDialog
        open={finalizeOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFinalizeOpen(false);
            setPin('');
          }
        }}
        title="Finalize financial Z"
        description="Operations already closed this Business Day. This action freezes an immutable financial snapshot and creates the daily Owner Summary."
        footer={
          <>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => {
                setFinalizeOpen(false);
                setPin('');
              }}
            >
              Cancel
            </button>
            <button
              className="admin-primary-button"
              type="button"
              disabled={!canFinalize || detail.command.isPending || !/^\d{4,12}$/.test(pin)}
              onClick={finalize}
            >
              Confirm financial Z
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <label>
            PIN confirmation
            <input
              type="password"
              value={pin}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
          {detail.command.error ? (
            <InlineError>
              {detail.command.error instanceof Error
                ? detail.command.error.message
                : 'Financial finalization failed'}
            </InlineError>
          ) : null}
        </div>
      </AdminDialog>
    </PageScaffold>
  );
}
