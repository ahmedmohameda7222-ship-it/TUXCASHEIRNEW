import { useMemo, useState, type FormEvent } from 'react';

import type {
  CatalogRecurringAvailabilityWorkspace,
  CatalogSaveRecurringAvailabilityRuleInput,
} from '@tux/admin-contracts';

type RecurringRuleDraft = Omit<CatalogSaveRecurringAvailabilityRuleInput, 'shopId'>;

type RecurringAvailabilityEditorProps = {
  workspace: CatalogRecurringAvailabilityWorkspace | undefined;
  isLoading: boolean;
  isError: boolean;
  disabled: boolean;
  isPending: boolean;
  onSave(input: RecurringRuleDraft): Promise<void>;
};

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const;

function shortTime(value: string): string {
  return value.slice(0, 5);
}

function daySummary(daysOfWeek: readonly number[]): string {
  const selected = new Set(daysOfWeek);
  return DAYS.filter((day) => selected.has(day.value))
    .map((day) => day.label.slice(0, 3))
    .join(', ');
}

export function RecurringAvailabilityEditor({
  workspace,
  isLoading,
  isError,
  disabled,
  isPending,
  onSave,
}: RecurringAvailabilityEditorProps) {
  const [masterProductId, setMasterProductId] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [available, setAvailable] = useState(true);

  const productByMasterId = useMemo(
    () => new Map((workspace?.products ?? []).map((product) => [product.masterProductId, product])),
    [workspace?.products],
  );

  const crossesMidnight = Boolean(startLocal && endLocal && endLocal <= startLocal);
  const canSubmit =
    !disabled &&
    !isPending &&
    masterProductId !== '' &&
    daysOfWeek.length > 0 &&
    startLocal !== '' &&
    endLocal !== '' &&
    startLocal !== endLocal;

  function toggleDay(day: number, checked: boolean) {
    setDaysOfWeek((current) => {
      const next = checked ? [...current, day] : current.filter((value) => value !== day);
      return [...new Set(next)].sort((left, right) => left - right);
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    await onSave({
      ruleId: null,
      masterProductId,
      daysOfWeek,
      startLocal,
      endLocal,
      available,
      active: true,
      expectedVersion: null,
    });
  }

  async function deactivateRule(ruleId: string) {
    const rule = workspace?.rules.find((candidate) => candidate.id === ruleId);
    if (!rule || disabled || isPending || !rule.active) return;

    await onSave({
      ruleId: rule.id,
      masterProductId: rule.masterProductId,
      daysOfWeek: rule.daysOfWeek,
      startLocal: rule.startLocal,
      endLocal: rule.endLocal,
      available: rule.available,
      active: false,
      expectedVersion: rule.version,
    });
  }

  return (
    <section
      className="admin-publish-card admin-recurring-card"
      aria-labelledby="recurring-availability-heading"
    >
      <div className="admin-publish-card__heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">Weekly controls</p>
          <h2 id="recurring-availability-heading">Recurring availability</h2>
        </div>
        <span className="admin-status-pill">Africa/Cairo</span>
      </div>

      <p className="admin-publish-card__copy">
        Define weekly Cairo-local availability windows. Overnight windows end on the next local day,
        and every rule change is version-fenced by the trusted catalog service.
      </p>

      {isLoading ? <div className="admin-catalog-loading">Loading recurring rules…</div> : null}
      {isError ? (
        <div className="admin-callout is-danger" role="alert">
          <strong>Recurring availability unavailable</strong>
          <span>Refresh before changing weekly product availability.</span>
        </div>
      ) : null}

      {workspace ? (
        <>
          <form className="admin-recurring-form" onSubmit={(event) => void submit(event)}>
            <label className="admin-field admin-recurring-product-field">
              <span>Product</span>
              <select
                value={masterProductId}
                onChange={(event) => setMasterProductId(event.target.value)}
                disabled={disabled || isPending}
              >
                <option value="">Select a product</option>
                {workspace.products.map((product) => (
                  <option key={product.masterProductId} value={product.masterProductId}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="admin-recurring-days" disabled={disabled || isPending}>
              <legend>Days</legend>
              <div className="admin-recurring-days__grid">
                {DAYS.map((day) => (
                  <label key={day.value} className="admin-recurring-day">
                    <input
                      type="checkbox"
                      checked={daysOfWeek.includes(day.value)}
                      onChange={(event) => toggleDay(day.value, event.target.checked)}
                    />
                    <span>{day.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="admin-recurring-times">
              <label className="admin-field">
                <span>Start time</span>
                <input
                  type="time"
                  value={startLocal}
                  onChange={(event) => setStartLocal(event.target.value)}
                  disabled={disabled || isPending}
                />
              </label>
              <label className="admin-field">
                <span>End time</span>
                <input
                  type="time"
                  value={endLocal}
                  onChange={(event) => setEndLocal(event.target.value)}
                  disabled={disabled || isPending}
                />
              </label>
            </div>

            <div className="admin-recurring-form__footer">
              <label className="admin-recurring-toggle">
                <input
                  type="checkbox"
                  checked={available}
                  onChange={(event) => setAvailable(event.target.checked)}
                  disabled={disabled || isPending}
                />
                <span>Available during window</span>
              </label>
              {crossesMidnight ? (
                <span className="admin-status-pill is-warning">Ends next day</span>
              ) : null}
            </div>

            <button className="admin-primary-button" type="submit" disabled={!canSubmit}>
              {isPending ? 'Saving…' : 'Save recurring rule'}
            </button>
          </form>

          <div className="admin-recurring-rules" aria-label="Recurring availability rules">
            {workspace.rules.length === 0 ? (
              <div className="admin-empty-state">
                <strong>No recurring rules</strong>
                <span>Add a weekly window when a product needs scheduled availability.</span>
              </div>
            ) : (
              workspace.rules.map((rule) => {
                const product = productByMasterId.get(rule.masterProductId);
                const productName = product?.name ?? 'Unknown product';
                return (
                  <article className="admin-recurring-rule" key={rule.id}>
                    <div className="admin-recurring-rule__main">
                      <div className="admin-publish-history__title">
                        <strong>{productName}</strong>
                        <span className={`admin-status-pill${rule.active ? '' : ' is-warning'}`}>
                          {rule.active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <span>{daySummary(rule.daysOfWeek)}</span>
                      <span>
                        {shortTime(rule.startLocal)}–{shortTime(rule.endLocal)}
                        {shortTime(rule.endLocal) <= shortTime(rule.startLocal)
                          ? ' · next day'
                          : ''}
                      </span>
                      <span>{rule.available ? 'Available' : 'Sold out'} during window</span>
                      <span>Rule version {rule.version}</span>
                      {product ? (
                        <span>
                          Manual baseline: {product.manualSoldOut ? 'Sold out' : 'Available'}
                        </span>
                      ) : null}
                    </div>
                    {rule.active ? (
                      <button
                        className="admin-danger-link"
                        type="button"
                        disabled={disabled || isPending}
                        aria-label={`Deactivate recurring rule for ${productName}`}
                        onClick={() => void deactivateRule(rule.id)}
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
