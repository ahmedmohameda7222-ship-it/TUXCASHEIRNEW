import type {
  AdminInventoryUsageVariance,
  AdminRecipeMarginAlert,
} from '@tux/admin-contracts';

import { PageScaffold } from '../components/layout/PageScaffold';
import { formatInventoryQuantity } from './InventoryItemPage';

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
  }).format(value)}%`;
}

export function VarianceReport({
  usage,
  margins,
}: {
  usage: readonly AdminInventoryUsageVariance[];
  margins: readonly AdminRecipeMarginAlert[];
}) {
  return (
    <PageScaffold
      eyebrow="Inventory intelligence"
      title="Usage & margin variance"
      description="Actual usage is ledger/stocktake-derived. Theoretical usage uses completed-order recipe consumption for the same period."
    >
      <section className="admin-inventory-card" aria-label="Actual versus theoretical usage">
        <h3>Actual vs theoretical usage</h3>
        {usage.length === 0 ? (
          <p className="admin-inventory-muted">No usage variance is available for this period.</p>
        ) : (
          <div className="admin-inventory-history__list">
            {usage.map((row) => (
              <article className="admin-inventory-history__row" key={row.inventoryItemId}>
                <div>
                  <strong>{row.itemName}</strong>
                  <span>
                    Actual {formatInventoryQuantity(row.actualUsageMicros, row.unitLabel)} ·
                    Theoretical{' '}
                    {formatInventoryQuantity(row.theoreticalUsageMicros, row.unitLabel)}
                  </span>
                </div>
                <div>
                  <strong>{formatInventoryQuantity(row.varianceMicros, row.unitLabel)}</strong>
                  <small>{formatPercent(row.variancePercent)} variance</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-inventory-card" aria-label="Food cost margin alerts">
        <h3>Food-cost margin alerts</h3>
        {margins.length === 0 ? (
          <p className="admin-inventory-muted">No configured product margin targets.</p>
        ) : (
          <div className="admin-inventory-history__list">
            {margins.map((margin) => (
              <article className="admin-inventory-history__row" key={margin.productId}>
                <div>
                  <strong>{margin.productName}</strong>
                  <span>
                    Food cost {formatPercent(margin.currentCostPercent)} · Target{' '}
                    {formatPercent(margin.targetCostPercent)}
                  </span>
                  <small>
                    Top contributors:{' '}
                    {margin.contributors
                      .slice(0, 3)
                      .map(
                        (ingredient) =>
                          `${ingredient.name} ${formatPercent(ingredient.sharePercent)}`,
                      )
                      .join(', ') || 'None'}
                  </small>
                </div>
                <div>
                  <strong>{margin.alert ? 'Margin alert' : 'Within target'}</strong>
                  <small>
                    {formatPercent(margin.overTargetPercentagePoints)} over target
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </PageScaffold>
  );
}
