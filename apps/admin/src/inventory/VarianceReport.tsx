import type {
  AdminInventoryMarginAlert,
  AdminInventoryVariance,
} from '@tux/admin-contracts';

function quantity(micros: number, unitLabel: string, signed = false): string {
  const value = micros / 1_000_000;
  const prefix = signed && value > 0 ? '+' : '';
  return `${prefix}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)} ${unitLabel}`;
}

function percent(value: number | null): string {
  if (value === null) return '—';
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)}%`;
}

export function VarianceReport({
  periodLabel,
  variances,
  marginAlerts,
  onBack,
}: {
  periodLabel: string;
  variances: readonly AdminInventoryVariance[];
  marginAlerts: readonly AdminInventoryMarginAlert[];
  onBack: () => void;
}) {
  return (
    <section className="admin-inventory-intelligence">
      <div className="admin-inventory-section-heading">
        <button className="admin-secondary-button" type="button" onClick={onBack}>
          Back
        </button>
        <div>
          <h2>Inventory variance &amp; margins</h2>
          <p>{periodLabel}</p>
        </div>
      </div>

      <div className="admin-inventory-intelligence-list">
        {variances.map((row) => (
          <article className="admin-inventory-intelligence-card" key={row.inventoryItemId}>
            <header>
              <strong>{row.itemName}</strong>
              <b>{percent(row.variancePercent)} variance</b>
            </header>
            <dl className="admin-inventory-metrics">
              <div>
                <dt>Actual</dt>
                <dd>{quantity(row.actualUsageMicros, row.unitLabel)}</dd>
              </div>
              <div>
                <dt>Theoretical</dt>
                <dd>{quantity(row.theoreticalUsageMicros, row.unitLabel)}</dd>
              </div>
              <div>
                <dt>Variance</dt>
                <dd>{quantity(row.varianceMicros, row.unitLabel, true)}</dd>
              </div>
              <div>
                <dt>Variance %</dt>
                <dd>{percent(row.variancePercent)}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      <h3>Food-cost margin alerts</h3>
      <div className="admin-inventory-intelligence-list">
        {marginAlerts.map((row) => (
          <article
            className={
              row.alert
                ? 'admin-inventory-intelligence-card is-alert'
                : 'admin-inventory-intelligence-card'
            }
            key={row.productId}
          >
            <header>
              <strong>{row.productName}</strong>
              <b>{row.foodCostPercent.toFixed(0)}% food cost</b>
            </header>
            <p>
              Target {row.targetFoodCostPercent.toFixed(0)}% · Alert at{' '}
              {row.alertThresholdPercent.toFixed(0)}%
            </p>
            {row.largestContributor ? (
              <p>
                Largest ingredient cost: {row.largestContributor.itemName} (
                {row.largestContributor.costMinor.toFixed(0)} minor units)
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
