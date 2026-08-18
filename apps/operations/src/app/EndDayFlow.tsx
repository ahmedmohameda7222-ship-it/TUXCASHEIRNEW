import type {
  EndDayGate,
  EndDayPaymentMethod,
  EndDayPreview,
  EndDayVarianceInput,
} from '@tux/application';
import { ZERO_MONEY, type MoneyMinor, type PaymentMethodId } from '@tux/domain';
import { useEffect, useMemo, useState } from 'react';
import { MoneyInput } from './MoneyInput';
import { formatMoneyMinor, resolveOrdersDraftScopeId } from './ordersView';
import type { OperationsEndDayClient } from './sessionClient';

type FlowStage =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'GATE'; readonly gate: EndDayGate }
  | { readonly kind: 'COUNT'; readonly gate: Extract<EndDayGate, { kind: 'READY' }> }
  | { readonly kind: 'SUMMARY'; readonly preview: EndDayPreview };

function actualPayments(
  methods: readonly EndDayPaymentMethod[],
  values: ReadonlyMap<PaymentMethodId, MoneyMinor>,
) {
  return methods.map((method) => ({
    paymentMethodId: method.id,
    actualMinor: values.get(method.id) ?? ZERO_MONEY,
  }));
}

export function EndDayFlow({
  client,
  onCancel,
  onReturnToOrders,
  onReturnToBoard,
  onClosed,
}: {
  readonly client: OperationsEndDayClient;
  readonly onCancel: () => void;
  readonly onReturnToOrders: () => void;
  readonly onReturnToBoard: () => void;
  readonly onClosed: () => Promise<void>;
}) {
  const draftScopeId = useMemo(() => resolveOrdersDraftScopeId(), []);
  const [stage, setStage] = useState<FlowStage>({ kind: 'LOADING' });
  const [methodIndex, setMethodIndex] = useState(0);
  const [actuals, setActuals] = useState<ReadonlyMap<PaymentMethodId, MoneyMinor>>(new Map());
  const [reasons, setReasons] = useState<ReadonlyMap<PaymentMethodId, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadGate(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await client.beginEndDay(draftScopeId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    if (result.value.kind === 'READY') {
      setActuals(new Map(result.value.paymentMethods.map((method) => [method.id, ZERO_MONEY])));
      setMethodIndex(0);
      setStage({ kind: 'COUNT', gate: result.value });
      return;
    }
    setStage({ kind: 'GATE', gate: result.value });
  }

  useEffect(() => {
    void loadGate();
  }, [client, draftScopeId]);

  async function discardDraftAndContinue(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await client.discardDraft(draftScopeId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await loadGate();
  }

  async function revealExpected(gate: Extract<EndDayGate, { kind: 'READY' }>): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await client.previewReconciliation({
      businessDayId: gate.businessDayId,
      draftScopeId,
      actualPayments: actualPayments(gate.paymentMethods, actuals),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setReasons(
      new Map(
        result.value.lines
          .filter((line) => line.differenceMinor !== ZERO_MONEY)
          .map((line) => [line.paymentMethod.id, '']),
      ),
    );
    setStage({ kind: 'SUMMARY', preview: result.value });
  }

  async function closeBusinessDay(preview: EndDayPreview): Promise<void> {
    const varianceReasons: EndDayVarianceInput[] = preview.lines.map((line) => ({
      paymentMethodId: line.paymentMethod.id,
      reason:
        line.differenceMinor === ZERO_MONEY ? null : (reasons.get(line.paymentMethod.id) ?? ''),
    }));
    setBusy(true);
    setError(null);
    const result = await client.closeDay({
      businessDayId: preview.businessDayId,
      draftScopeId,
      actualPayments: preview.lines.map((line) => ({
        paymentMethodId: line.paymentMethod.id,
        actualMinor: line.actualMinor,
      })),
      varianceReasons,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await onClosed();
  }

  return (
    <div className="end-day-backdrop" role="presentation">
      <section
        className="end-day-flow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-day-title"
      >
        <header className="end-day-heading">
          <div>
            <p className="eyebrow">Business Day close</p>
            <h2 id="end-day-title">End Day</h2>
          </div>
          <button type="button" className="quiet-action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </header>

        {stage.kind === 'LOADING' ? (
          <p className="end-day-muted">Checking local Business Day…</p>
        ) : null}

        {stage.kind === 'GATE' && stage.gate.kind === 'ACTIVE_ORDERS_BLOCKED' ? (
          <div className="end-day-blocked">
            <h3>Resolve Active orders first</h3>
            <p>
              {stage.gate.activeOrderNos.map((number) => `#${number}`).join(', ')} still need Done
              or Cancel before reconciliation can start.
            </p>
            <button type="button" className="primary-action" onClick={onReturnToBoard}>
              Go to Orders Board
            </button>
          </div>
        ) : null}

        {stage.kind === 'GATE' && stage.gate.kind === 'UNFINISHED_DRAFT' ? (
          <div className="end-day-blocked">
            <h3>You have an unfinished order.</h3>
            <p>End Day will never silently discard the current order draft.</p>
            <div className="end-day-choice-actions">
              <button type="button" className="end-day-secondary-action" onClick={onReturnToOrders}>
                Return to Order
              </button>
              <button
                type="button"
                className="end-day-danger-action"
                disabled={busy}
                onClick={() => void discardDraftAndContinue()}
              >
                {busy ? 'Discarding…' : 'Discard Draft & Continue'}
              </button>
            </div>
          </div>
        ) : null}

        {stage.kind === 'COUNT' ? (
          <div className="end-day-count">
            {stage.gate.paymentMethods.length === 0 ? (
              <div className="end-day-blocked">
                <h3>Reconciliation configuration is unavailable</h3>
                <p>At least one active Cash or Digital reconciliation method is required.</p>
              </div>
            ) : (
              (() => {
                const method = stage.gate.paymentMethods[methodIndex];
                if (method === undefined) return null;
                const last = methodIndex === stage.gate.paymentMethods.length - 1;
                return (
                  <>
                    <div className="end-day-step-meta">
                      <span>
                        Count {methodIndex + 1} of {stage.gate.paymentMethods.length}
                      </span>
                      <strong>{method.label}</strong>
                    </div>
                    <h3>Enter actual {method.label}</h3>
                    <p className="end-day-muted">
                      Count what is actually present. Expected values remain hidden until every
                      actual amount is submitted.
                    </p>
                    <MoneyInput
                      id={`end-day-actual-${method.id}`}
                      label={`Actual ${method.label}`}
                      value={actuals.get(method.id) ?? ZERO_MONEY}
                      disabled={busy}
                      onCommit={(value) => {
                        setActuals((current) => {
                          const next = new Map(current);
                          next.set(method.id, value);
                          return next;
                        });
                      }}
                    />
                    <div className="end-day-navigation-actions">
                      {methodIndex === 0 ? (
                        <span />
                      ) : (
                        <button
                          type="button"
                          className="end-day-secondary-action"
                          disabled={busy}
                          onClick={() => setMethodIndex((index) => index - 1)}
                        >
                          Back
                        </button>
                      )}
                      <button
                        type="button"
                        className="primary-action"
                        disabled={busy}
                        onClick={() => {
                          if (last) void revealExpected(stage.gate);
                          else setMethodIndex((index) => index + 1);
                        }}
                      >
                        {busy ? 'Checking…' : last ? 'Reveal Reconciliation' : 'Next'}
                      </button>
                    </div>
                  </>
                );
              })()
            )}
          </div>
        ) : null}

        {stage.kind === 'SUMMARY' ? (
          <div className="end-day-summary">
            <div>
              <p className="eyebrow">Final Closing Summary</p>
              <h3>Review before closing</h3>
              <p className="end-day-muted">
                Variance is allowed, but every non-zero difference needs a reason. Closing writes
                the Business Day locally and does not depend on cloud or printing.
              </p>
            </div>

            <div className="end-day-summary-totals">
              <div>
                <span>Recognized Sales</span>
                <strong>{formatMoneyMinor(stage.preview.recognizedSalesMinor)}</strong>
              </div>
              <div>
                <span>Total Expenses</span>
                <strong>{formatMoneyMinor(stage.preview.totalExpensesMinor)}</strong>
              </div>
            </div>

            <div className="end-day-reconciliation-lines">
              {stage.preview.lines.map((line) => (
                <article className="end-day-reconciliation-line" key={line.paymentMethod.id}>
                  <header>
                    <strong>{line.paymentMethod.label}</strong>
                    <span
                      className={
                        line.differenceMinor === ZERO_MONEY ? 'end-day-match' : 'end-day-variance'
                      }
                    >
                      {line.differenceMinor === ZERO_MONEY ? 'Matched' : 'Variance'}
                    </span>
                  </header>
                  <dl>
                    <div>
                      <dt>Expected</dt>
                      <dd>{formatMoneyMinor(line.expectedMinor)}</dd>
                    </div>
                    <div>
                      <dt>Actual</dt>
                      <dd>{formatMoneyMinor(line.actualMinor)}</dd>
                    </div>
                    <div>
                      <dt>Difference</dt>
                      <dd>{formatMoneyMinor(line.differenceMinor)}</dd>
                    </div>
                  </dl>
                  {line.differenceMinor === ZERO_MONEY ? null : (
                    <label htmlFor={`end-day-reason-${line.paymentMethod.id}`}>
                      Variance reason
                      <textarea
                        id={`end-day-reason-${line.paymentMethod.id}`}
                        rows={2}
                        maxLength={500}
                        value={reasons.get(line.paymentMethod.id) ?? ''}
                        disabled={busy}
                        onChange={(event) => {
                          const value = event.target.value;
                          setReasons((current) => {
                            const next = new Map(current);
                            next.set(line.paymentMethod.id, value);
                            return next;
                          });
                        }}
                      />
                    </label>
                  )}
                </article>
              ))}
            </div>

            <div className="end-day-navigation-actions">
              <button
                type="button"
                className="end-day-secondary-action"
                disabled={busy}
                onClick={() => {
                  const gate: Extract<EndDayGate, { kind: 'READY' }> = {
                    kind: 'READY',
                    businessDayId: stage.preview.businessDayId,
                    paymentMethods: stage.preview.lines.map((line) => line.paymentMethod),
                  };
                  setMethodIndex(0);
                  setStage({ kind: 'COUNT', gate });
                }}
              >
                Back to Counts
              </button>
              <button
                type="button"
                className="primary-action"
                disabled={
                  busy ||
                  stage.preview.lines.some(
                    (line) =>
                      line.differenceMinor !== ZERO_MONEY &&
                      (reasons.get(line.paymentMethod.id)?.trim().length ?? 0) === 0,
                  )
                }
                onClick={() => void closeBusinessDay(stage.preview)}
              >
                {busy ? 'Closing locally…' : 'Close Business Day'}
              </button>
            </div>
          </div>
        ) : null}

        {error === null ? null : (
          <p className="form-error end-day-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
