import type { AdminReorderSuggestion } from '@tux/admin-contracts';

import { PageScaffold } from '../components/layout/PageScaffold';
import { formatInventoryQuantity } from './InventoryItemPage';

export function ReorderSuggestionsPage({
  suggestions,
}: {
  suggestions: readonly AdminReorderSuggestion[];
}) {
  const actionable = suggestions.filter((suggestion) => suggestion.suggestedOrderMicros > 0);

  return (
    <PageScaffold
      eyebrow="Inventory intelligence"
      title="Reorder suggestions"
      description="Suggestions are advisory only. TUX never places a supplier order automatically."
    >
      {actionable.length === 0 ? (
        <div className="admin-empty-state">
          <strong>No reorder suggested.</strong>
          <span>Available plus incoming stock currently covers configured par targets.</span>
        </div>
      ) : (
        <div className="admin-inventory-card-list">
          {actionable.map((suggestion) => (
            <article className="admin-inventory-card" key={suggestion.inventoryItemId}>
              <div className="admin-inventory-history__header">
                <div>
                  <h3>{suggestion.itemName}</h3>
                  <span>
                    {suggestion.preferredSupplierName ?? 'No preferred supplier configured'}
                  </span>
                </div>
                <strong>
                  Order{' '}
                  {formatInventoryQuantity(
                    suggestion.suggestedOrderMicros,
                    suggestion.unitLabel,
                  )}
                </strong>
              </div>
              <dl className="inventory-balance-grid">
                <div>
                  <dt>Available</dt>
                  <dd>
                    {formatInventoryQuantity(
                      suggestion.availableMicros,
                      suggestion.unitLabel,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Incoming</dt>
                  <dd>
                    {formatInventoryQuantity(
                      suggestion.incomingMicros,
                      suggestion.unitLabel,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Par target</dt>
                  <dd>
                    {formatInventoryQuantity(
                      suggestion.parLevelMicros,
                      suggestion.unitLabel,
                    )}
                  </dd>
                </div>
              </dl>
              <div className="admin-inventory-policy-grid">
                <div>
                  <span>Lead time</span>
                  <strong>{suggestion.leadTimeDays} days</strong>
                </div>
                <div>
                  <span>Purchase unit</span>
                  <strong>{suggestion.preferredPurchaseUnitLabel ?? 'Base unit'}</strong>
                </div>
                <div>
                  <span>Minimum order</span>
                  <strong>
                    {suggestion.minimumOrderMicros === null
                      ? 'None'
                      : formatInventoryQuantity(
                          suggestion.minimumOrderMicros,
                          suggestion.unitLabel,
                        )}
                  </strong>
                </div>
                <div>
                  <span>Order multiple</span>
                  <strong>
                    {suggestion.orderMultipleMicros === null
                      ? 'None'
                      : formatInventoryQuantity(
                          suggestion.orderMultipleMicros,
                          suggestion.unitLabel,
                        )}
                  </strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </PageScaffold>
  );
}
