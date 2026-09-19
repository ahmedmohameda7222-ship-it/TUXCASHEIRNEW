import type { AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { AdjustStockSheet } from './AdjustStockSheet';
import { InventoryItemPage } from './InventoryItemPage';
import { RecordWasteSheet } from './RecordWasteSheet';
import { ReorderSuggestionsPage } from './ReorderSuggestionsPage';
import { StocktakePage } from './StocktakePage';
import { TransferPage } from './TransferPage';
import { useInventory } from './useInventory';
import { VarianceReport } from './VarianceReport';
import './inventory.css';

type WorkspaceMode = 'detail' | 'stocktake' | 'transfer' | 'reorder' | 'variance';
type ItemAction = 'adjust' | 'waste' | null;

export function InventoryPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const inventory = useInventory(shopId);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>('detail');
  const [itemAction, setItemAction] = useState<ItemAction>(null);
  const [stocktakeSnapshot, setStocktakeSnapshot] = useState<AdminStocktakeSnapshot | null>(null);

  const workspace = inventory.workspaceQuery.data;
  const items = workspace?.items ?? [];

  useEffect(() => {
    if (selectedItemId && items.some((item) => item.id === selectedItemId)) return;
    setSelectedItemId(null);
    setItemAction(null);
  }, [items, selectedItemId]);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Inventory"
        title="Inventory"
        description="Select a concrete shop to work with inventory balances and movements."
      />
    );
  }

  const canAdjust = principal.permissions.includes('inventory.adjust');
  const canStocktake = principal.permissions.includes('inventory.stocktake');
  const canTransfer = principal.permissions.includes('inventory.transfer');
  const canManageReplenishment = principal.permissions.includes('purchasing.manage');
  const canOverrideNegative =
    principal.role === 'OWNER' && principal.permissions.includes('inventory.override_negative');

  if (inventory.workspaceQuery.isLoading) {
    return (
      <PageScaffold eyebrow="Inventory" title="Inventory" description="Loading inventory ledger…" />
    );
  }

  if (inventory.workspaceQuery.isError || !workspace) {
    return (
      <PageScaffold
        eyebrow="Inventory"
        title="Inventory"
        description="Inventory could not be loaded. Retry after the Admin backend is available."
      />
    );
  }

  return (
    <PageScaffold
      eyebrow="Inventory control"
      title="Inventory"
      description="On-hand, reservations, stock counts, waste and inter-shop transfers are posted through the immutable inventory ledger."
      primaryAction={
        <div className="admin-inventory-page-actions">
          {canStocktake ? (
            <button
              className="admin-secondary-button"
              type="button"
              disabled={inventory.beginStocktake.isPending || items.length === 0}
              onClick={() => {
                inventory.beginStocktake.mutate(
                  items.map((item) => item.id),
                  {
                    onSuccess: (snapshot) => {
                      setStocktakeSnapshot(snapshot);
                      setMode('stocktake');
                      setItemAction(null);
                    },
                  },
                );
              }}
            >
              Stock count
            </button>
          ) : null}
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => {
              setMode('reorder');
              setItemAction(null);
            }}
          >
            Reorder
          </button>
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => {
              setMode('variance');
              setItemAction(null);
            }}
          >
            Variance & margins
          </button>
          {canTransfer ? (
            <button
              className="admin-primary-button"
              type="button"
              onClick={() => {
                setMode('transfer');
                setItemAction(null);
              }}
            >
              Transfer stock
            </button>
          ) : null}
        </div>
      }
    >
      {mode === 'reorder' ? (
        <ReorderSuggestionsPage
          suggestions={workspace.intelligence.reorderSuggestions}
          canManage={canManageReplenishment}
          saving={inventory.updateReplenishment.isPending}
          onBack={() => setMode('detail')}
          onSave={(inventoryItemId, input) =>
            inventory.updateReplenishment.mutate({ inventoryItemId, ...input })
          }
        />
      ) : mode === 'variance' ? (
        <VarianceReport
          periodLabel={workspace.intelligence.periodLabel}
          variances={workspace.intelligence.variances}
          marginAlerts={workspace.intelligence.marginAlerts}
          onBack={() => setMode('detail')}
        />
      ) : mode === 'stocktake' && stocktakeSnapshot ? (
        <StocktakePage
          items={items}
          snapshot={stocktakeSnapshot}
          pending={inventory.postStocktake.isPending}
          onBack={() => {
            setStocktakeSnapshot(null);
            setMode('detail');
          }}
          onSubmit={(lines) =>
            inventory.postStocktake.mutate(
              { stocktakeId: stocktakeSnapshot.stocktakeId, lines },
              {
                onSuccess: () => {
                  setStocktakeSnapshot(null);
                  setMode('detail');
                },
              },
            )
          }
        />
      ) : mode === 'transfer' ? (
        <TransferPage
          shopId={shopId}
          shopIds={principal.shopIds}
          items={items}
          transfers={workspace.transfers}
          sending={inventory.sendTransfer.isPending}
          receiving={inventory.receiveTransfer.isPending}
          onBack={() => setMode('detail')}
          onSend={(input) => inventory.sendTransfer.mutate(input)}
          onReceive={(transferId) => inventory.receiveTransfer.mutate(transferId)}
        />
      ) : (
        <div className="admin-inventory-layout">
          <section className="admin-inventory-list" aria-label="Inventory items">
            <div className="admin-inventory-list__header">
              <strong>{items.length} items</strong>
              <span>Available = On Hand − Reserved</span>
            </div>
            {items.length === 0 ? (
              <div className="admin-empty-state">
                <strong>No inventory items</strong>
                <span>Inventory configuration for this shop is empty.</span>
              </div>
            ) : (
              items.map((item) => (
                <button
                  className={
                    item.id === selectedItemId
                      ? 'admin-inventory-row is-selected'
                      : 'admin-inventory-row'
                  }
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedItemId(item.id);
                    setItemAction(null);
                  }}
                >
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.trackingMode.replaceAll('_', ' ')}</small>
                  </span>
                  <span>
                    {new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
                      item.availableMicros / 1_000_000,
                    )}{' '}
                    {item.unitLabel}
                  </span>
                </button>
              ))
            )}
          </section>

          <section className="admin-inventory-inspector">
            {selectedItem ? (
              <>
                <InventoryItemPage
                  item={selectedItem}
                  actions={
                    canAdjust ? (
                      <>
                        <button
                          className="admin-secondary-button"
                          type="button"
                          onClick={() => setItemAction('adjust')}
                        >
                          Adjust stock
                        </button>
                        <button
                          className="admin-secondary-button"
                          type="button"
                          onClick={() => setItemAction('waste')}
                        >
                          Record waste
                        </button>
                      </>
                    ) : undefined
                  }
                />
                {itemAction === 'adjust' ? (
                  <AdjustStockSheet
                    item={selectedItem}
                    reasons={workspace.reasonCodes}
                    canOverrideNegative={canOverrideNegative}
                    pending={inventory.adjustStock.isPending}
                    onCancel={() => setItemAction(null)}
                    onSubmit={(input) =>
                      inventory.adjustStock.mutate(
                        { inventoryItemId: selectedItem.id, ...input },
                        { onSuccess: () => setItemAction(null) },
                      )
                    }
                  />
                ) : null}
                {itemAction === 'waste' ? (
                  <RecordWasteSheet
                    item={selectedItem}
                    reasons={workspace.reasonCodes}
                    canOverrideNegative={canOverrideNegative}
                    pending={inventory.recordWaste.isPending}
                    onCancel={() => setItemAction(null)}
                    onSubmit={(input) =>
                      inventory.recordWaste.mutate(
                        { inventoryItemId: selectedItem.id, ...input },
                        { onSuccess: () => setItemAction(null) },
                      )
                    }
                  />
                ) : null}
              </>
            ) : (
              <div className="admin-empty-state">
                <strong>Select an inventory item</strong>
                <span>Review balances, history, adjustments and waste from one detail view.</span>
              </div>
            )}
          </section>
        </div>
      )}
    </PageScaffold>
  );
}
