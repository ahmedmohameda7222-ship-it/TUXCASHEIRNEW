import type { AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
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

function trackingModeLabel(mode: string): string {
  return mode === 'BATCH_TRACKED'
    ? 'Batch tracked'
    : mode === 'SERIAL_TRACKED'
      ? 'Serial tracked'
      : 'Standard stock';
}

const STOCKTAKE_BATCH_SIZE = 500;

function latestMutationError(
  mutations: readonly { error: unknown; submittedAt: number }[],
): unknown {
  let latest: { error: unknown; submittedAt: number } | null = null;
  for (const mutation of mutations) {
    if (mutation.submittedAt <= 0) continue;
    if (latest === null || mutation.submittedAt >= latest.submittedAt) latest = mutation;
  }
  return latest?.error ?? null;
}

function mutationErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const code = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (code.includes('insufficient_stock'))
    return 'There is not enough available stock for this action.';
  if (code.includes('conflict'))
    return 'Inventory changed while you were working. Reload and try again.';
  if (code.includes('forbidden') || code.includes('permission'))
    return 'You do not have permission to complete this inventory action.';
  return 'The inventory action could not be completed. Reload and try again.';
}

type WorkspaceMode =
  'detail' | 'stocktake-select' | 'stocktake' | 'transfer' | 'reorder' | 'variance';
type ItemAction = 'adjust' | 'waste' | null;

export function InventoryPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const selectedItemId = detailIdFromPath(location, '/inventory');
  const inventory = useInventory(shopId, selectedItemId);
  const [mode, setMode] = useState<WorkspaceMode>('detail');
  const [itemAction, setItemAction] = useState<ItemAction>(null);
  const [stocktakeSnapshot, setStocktakeSnapshot] = useState<AdminStocktakeSnapshot | null>(null);

  const workspace = inventory.workspaceQuery.data;
  const mutationError = latestMutationError([
    inventory.adjustStock,
    inventory.recordWaste,
    inventory.beginStocktake,
    inventory.postStocktake,
    inventory.updateReplenishment,
    inventory.sendTransfer,
    inventory.receiveTransfer,
  ]);
  const mutationErrorText = mutationErrorMessage(mutationError);
  const items = workspace?.items ?? [];
  const stocktakeItems = useMemo(() => items.filter((item) => item.active), [items]);

  const selectedItem = useMemo(() => {
    const item = items.find((candidate) => candidate.id === selectedItemId) ?? null;
    if (item === null) return null;
    const history =
      inventory.itemHistoryQuery.data?.inventoryItemId === item.id
        ? inventory.itemHistoryQuery.data.history
        : [];
    return { ...item, history };
  }, [inventory.itemHistoryQuery.data, items, selectedItemId]);

  const stocktakeBatches = useMemo(() => {
    const batches = [];
    for (let start = 0; start < stocktakeItems.length; start += STOCKTAKE_BATCH_SIZE) {
      batches.push(stocktakeItems.slice(start, start + STOCKTAKE_BATCH_SIZE));
    }
    return batches;
  }, [stocktakeItems]);

  const beginStocktakeBatch = (batch: typeof items) => {
    inventory.beginStocktake.mutate(
      batch.map((item) => item.id),
      {
        onSuccess: (snapshot) => {
          setStocktakeSnapshot(snapshot);
          setMode('stocktake');
          setItemAction(null);
          navigate('/inventory');
        },
      },
    );
  };

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Inventory"
        title="Inventory"
        description="Select a shop to review inventory balances and movements."
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
      <PageScaffold
        eyebrow="Inventory"
        title="Inventory"
        description="Review stock across this shop."
      >
        <LoadingState
          title="Loading inventory"
          description="Preparing current balances and availability."
        />
      </PageScaffold>
    );
  }

  if (inventory.workspaceQuery.isError || !workspace) {
    return (
      <PageScaffold
        eyebrow="Inventory"
        title="Inventory"
        description="Review stock across this shop."
      >
        <ErrorState
          title="Inventory could not be loaded"
          description="Retry when the Admin service is available."
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void inventory.workspaceQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      </PageScaffold>
    );
  }

  function openWorkflow(nextMode: WorkspaceMode) {
    navigate('/inventory');
    setMode(nextMode);
    setItemAction(null);
  }

  return (
    <PageScaffold
      eyebrow="Inventory control"
      title="Inventory"
      description="Review availability, stock counts, waste and transfers for this shop."
      primaryAction={
        <div className="admin-inventory-page-actions">
          {canStocktake ? (
            <button
              className="admin-primary-button"
              type="button"
              disabled={inventory.beginStocktake.isPending || stocktakeItems.length === 0}
              onClick={() => {
                if (stocktakeItems.length > STOCKTAKE_BATCH_SIZE) {
                  openWorkflow('stocktake-select');
                  return;
                }
                beginStocktakeBatch(stocktakeItems);
              }}
            >
              Stock count
            </button>
          ) : canTransfer ? (
            <button
              className="admin-primary-button"
              type="button"
              onClick={() => openWorkflow('transfer')}
            >
              Transfer stock
            </button>
          ) : null}
          <details className="admin-inventory-more-actions">
            <summary className="admin-secondary-button">More actions</summary>
            <div>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => openWorkflow('reorder')}
              >
                Reorder suggestions
              </button>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => openWorkflow('variance')}
              >
                Variance &amp; margins
              </button>
              {canStocktake && canTransfer ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => openWorkflow('transfer')}
                >
                  Transfer stock
                </button>
              ) : null}
            </div>
          </details>
        </div>
      }
    >
      {mutationErrorText ? (
        <p className="admin-inventory-note" role="alert">
          {mutationErrorText}
        </p>
      ) : null}
      {mode === 'stocktake-select' ? (
        <section
          className="admin-inventory-workflow"
          aria-labelledby="inventory-stocktake-batch-title"
        >
          <div className="admin-inventory-workflow__header">
            <div>
              <p className="admin-page__eyebrow">Stock count</p>
              <h2 id="inventory-stocktake-batch-title">Choose a batch</h2>
            </div>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setMode('detail')}
            >
              Back to inventory
            </button>
          </div>
          <p>
            Count up to {STOCKTAKE_BATCH_SIZE} items per session. Complete one batch, then start the
            next batch from Inventory.
          </p>
          <div className="admin-inventory-list" aria-label="Stock count batches">
            {stocktakeBatches.map((batch, index) => {
              const first = batch[0];
              const last = batch[batch.length - 1];
              return (
                <button
                  className="admin-inventory-row"
                  type="button"
                  key={first?.id ?? index}
                  disabled={inventory.beginStocktake.isPending}
                  onClick={() => beginStocktakeBatch(batch)}
                >
                  <span>
                    <strong>Batch {index + 1}</strong>
                    <small>
                      {first && last ? `${first.name} – ${last.name}` : 'Inventory items'}
                    </small>
                  </span>
                  <span>{batch.length} items</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : mode === 'reorder' ? (
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
          shops={
            workspace.shops ??
            principal.shopIds.map((id, index) => ({ id, name: `Authorized shop ${index + 1}` }))
          }
          items={items}
          transfers={workspace.transfers}
          sending={inventory.sendTransfer.isPending}
          receiving={inventory.receiveTransfer.isPending}
          onBack={() => setMode('detail')}
          onSend={(input) => inventory.sendTransfer.mutate(input)}
          onReceive={(transferId) => inventory.receiveTransfer.mutate(transferId)}
        />
      ) : (
        <ResponsiveMasterDetail
          listLabel="Inventory items"
          detailLabel="Inventory item detail"
          detailActive={selectedItemId !== null}
          backHref="/inventory"
          list={
            <div className="admin-inventory-list">
              <div className="admin-inventory-list__header">
                <strong>{items.length} items</strong>
                <span>Available = On Hand − Reserved</span>
              </div>
              {items.length === 0 ? (
                <EmptyState
                  title="No inventory items"
                  description="Inventory configuration for this shop is empty."
                />
              ) : (
                items.map((item) => (
                  <button
                    className={
                      item.id === selectedItemId
                        ? 'admin-inventory-row is-selected'
                        : 'admin-inventory-row'
                    }
                    aria-current={item.id === selectedItemId ? 'true' : undefined}
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigate(detailPath('/inventory', item.id));
                      setItemAction(null);
                    }}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{trackingModeLabel(item.trackingMode)}</small>
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
            </div>
          }
          detail={
            inventory.itemHistoryQuery.isLoading ? (
              <LoadingState title="Loading item detail" />
            ) : inventory.itemHistoryQuery.isError ? (
              <ErrorState
                title="Inventory item unavailable"
                description="This item may not exist or may not be available in your current shop scope."
              />
            ) : selectedItem ? (
              <>
                <InventoryItemPage
                  item={selectedItem}
                  actions={
                    canAdjust && selectedItem.active ? (
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
                {itemAction === 'adjust' && selectedItem.active ? (
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
                {itemAction === 'waste' && selectedItem.active ? (
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
              <EmptyState
                title="Inventory item unavailable"
                description="Choose another item from the list."
              />
            )
          }
          emptyDetail={
            <EmptyState
              title="Select an inventory item"
              description="Review balances, history, adjustments and waste from one detail view."
            />
          }
        />
      )}
    </PageScaffold>
  );
}
