import type { AdminStocktakeDraftSession, AdminStocktakeSnapshot } from '@tux/admin-contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { useShopScope } from '../shops/ShopScopeProvider';
import { AdjustStockSheet } from './AdjustStockSheet';
import { InventoryItemPage } from './InventoryItemPage';
import { InventoryDefinitionEditor } from './InventoryDefinitionEditor';
import { inventoryCsv } from './inventoryCsv';
import { InventoryMasterBindingPanel } from './InventoryMasterBindingPanel';
import {
  inventoryCounts,
  inventoryDisplayRows,
  inventoryStatus,
  trackingModeLabel,
  type InventoryFilter,
  type InventorySort,
} from './inventoryPresentation';
import { RecordWasteSheet } from './RecordWasteSheet';
import { ReorderSuggestionsPage } from './ReorderSuggestionsPage';
import { StocktakePage } from './StocktakePage';
import { TransferPage } from './TransferPage';
import { useInventory } from './useInventory';
import { VarianceReport } from './VarianceReport';
import './inventory.css';

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
  if (code.includes('inventory_master_unit_locked'))
    return 'This ingredient has a business-wide recipe master binding. Its base unit and tracking mode cannot change.';
  if (code.includes('stocktake_snapshot_stale'))
    return 'Stock changed after this count began. Reconcile the late movement, then start a fresh physical count.';
  if (code.includes('stocktake_requires_off_shift') || code.includes('active_worker_session'))
    return 'Stocktake is blocked during live trading. End the shift before counting.';
  if (code.includes('unfinished_orders'))
    return 'Finalize all stock-affecting orders before starting or posting a physical count.';
  if (code.includes('destination_inventory_master_mapping_required'))
    return 'The destination item requires the same authorized recipe master binding, base unit and tracking mode. Configure master bindings before sending.';
  if (code.includes('transfer_not_cancellable'))
    return 'This transfer is already received or otherwise final and cannot be cancelled.';
  if (code.includes('insufficient_stock'))
    return 'There is not enough available stock for this action.';
  if (code.includes('conflict'))
    return 'Inventory changed while you were working. Reload and try again.';
  if (code.includes('forbidden') || code.includes('permission'))
    return 'You do not have permission to complete this inventory action.';
  return 'The inventory action could not be completed. Reload and try again.';
}

type WorkspaceMode =
  | 'detail'
  | 'stocktake-select'
  | 'stocktake-history'
  | 'stocktake'
  | 'transfer'
  | 'reorder'
  | 'variance'
  | 'master-bindings';
type ItemAction = 'adjust' | 'waste' | null;

export function InventoryPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const selectedItemId = detailIdFromPath(location, '/inventory');
  const inventory = useInventory(shopId, selectedItemId);
  const [mode, setMode] = useState<WorkspaceMode>('detail');
  const moreActionsRef = useRef<HTMLDetailsElement>(null);

  // A native details menu is a disclosure, not a persistent route selection.
  useEffect(() => {
    if (moreActionsRef.current) moreActionsRef.current.open = false;
  }, [location, mode, shopId]);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (!moreActionsRef.current?.contains(event.target as Node)) {
        if (moreActionsRef.current) moreActionsRef.current.open = false;
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && moreActionsRef.current?.open) {
        moreActionsRef.current.open = false;
        moreActionsRef.current.querySelector('summary')?.focus();
        event.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, []);

  const [itemAction, setItemAction] = useState<ItemAction>(null);
  const [adjustmentApprovalPending, setAdjustmentApprovalPending] = useState(false);
  const [definitionItemId, setDefinitionItemId] = useState<string | null>(null);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InventoryFilter>('all');
  const [sort, setSort] = useState<InventorySort>('name');
  const [page, setPage] = useState(1);
  const [stocktakeSnapshot, setStocktakeSnapshot] = useState<AdminStocktakeSnapshot | null>(null);
  const [stocktakeRevision, setStocktakeRevision] = useState(0);
  const [stocktakeStale, setStocktakeStale] = useState(false);
  const [stocktakeSavedValues, setStocktakeSavedValues] = useState<Record<string, number | null>>(
    {},
  );

  const workspace = inventory.workspaceQuery.data;
  const mutationError = latestMutationError([
    inventory.adjustStock,
    inventory.recordWaste,
    inventory.beginStocktake,
    inventory.postStocktake,
    inventory.saveStocktakeDraft,
    inventory.cancelStocktakeDraft,
    inventory.updateReplenishment,
    inventory.sendTransfer,
    inventory.receiveTransfer,
    inventory.manageDefinition,
  ]);
  const mutationErrorText = mutationErrorMessage(mutationError);
  const items = workspace?.items ?? [];
  const counts = useMemo(() => inventoryCounts(items), [items]);
  const display = useMemo(
    () => inventoryDisplayRows(items, search, statusFilter, sort, page),
    [items, search, statusFilter, sort, page],
  );
  useEffect(() => {
    setSearch('');
    setStatusFilter('all');
    setSort('name');
    setPage(1);
    setItemAction(null);
    setAdjustmentApprovalPending(false);
    setDefinitionOpen(false);
    setStocktakeSnapshot(null);
    setStocktakeRevision(0);
    setStocktakeStale(false);
    setStocktakeSavedValues({});
    setMode('detail');
  }, [shopId]);
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
          setStocktakeRevision(0);
          setStocktakeStale(false);
          setStocktakeSavedValues({});
          setMode('stocktake');
          setItemAction(null);
          navigate('/inventory');
        },
      },
    );
  };

  const resumeStocktake = (session: AdminStocktakeDraftSession) => {
    if (!shopId || session.shopId !== shopId || session.status !== 'DRAFT') return;
    setStocktakeSnapshot({
      stocktakeId: session.stocktakeId,
      lines: session.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        snapshotOnHandMicros: line.snapshotOnHandMicros,
        snapshotReservedMicros: line.snapshotReservedMicros,
        unitCostMinor: line.unitCostMinor,
      })),
    });
    setStocktakeRevision(session.draftRevision);
    setStocktakeStale(session.stale);
    setStocktakeSavedValues(
      Object.fromEntries(
        session.lines.map((line) => [line.inventoryItemId, line.actualCountMicros]),
      ),
    );
    setMode('stocktake');
    navigate('/inventory');
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
  const stocktakeAllowed = inventory.stocktakeEligibilityQuery.data?.allowed === true;
  const eligibilityCode = inventory.stocktakeEligibilityQuery.data?.code;
  const stocktakeReason = inventory.stocktakeEligibilityQuery.isError
    ? 'Safety verification is unavailable. Stock count is blocked until the trusted server can confirm the shift has ended.'
    : eligibilityCode === 'active_worker_session'
      ? 'A worker session is active. Physical stock counting is available only after the last trading shift ends.'
      : eligibilityCode === 'unfinished_orders'
        ? 'Unfinished orders are still present. Finalize active stock-affecting orders before counting.'
        : !stocktakeAllowed
          ? 'Checking shift and order eligibility; stock count is unavailable until confirmed.'
          : null;
  const canTransfer = principal.permissions.includes('inventory.transfer');
  const canManageReplenishment = principal.permissions.includes('purchasing.manage');
  const canManageDefinitions = principal.permissions.includes('purchasing.manage');
  const canManageMasterBindings =
    (principal.role === 'OWNER' || principal.role === 'ADMIN') &&
    principal.permissions.includes('inventory.view') &&
    principal.permissions.includes('inventory.adjust') &&
    principal.permissions.includes('catalog.edit');
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
      description="Review stock levels, manage counts, adjustments, waste and transfers."
      primaryAction={
        <div className="admin-inventory-page-actions">
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => {
              const csv = inventoryCsv(items);
              const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `inventory-${shopId}.csv`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            Export CSV
          </button>
          {canManageDefinitions ? (
            <button
              className="admin-primary-button"
              type="button"
              onClick={() => {
                setDefinitionItemId(null);
                setDefinitionOpen(true);
                setMode('detail');
                navigate('/inventory');
              }}
            >
              Add inventory item
            </button>
          ) : null}
          {canStocktake ? (
            <button
              className="admin-primary-button"
              type="button"
              disabled={
                inventory.beginStocktake.isPending ||
                stocktakeItems.length === 0 ||
                !stocktakeAllowed
              }
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
          <details className="admin-inventory-more-actions" ref={moreActionsRef}>
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
              {canStocktake ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => openWorkflow('stocktake-history')}
                >
                  Stock count history
                </button>
              ) : null}
              {canManageMasterBindings ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => openWorkflow('master-bindings')}
                >
                  Manage recipe master bindings
                </button>
              ) : null}
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
      {canStocktake && stocktakeReason ? (
        <p role="status" className="admin-inventory-note">
          {stocktakeReason}
        </p>
      ) : null}
      {adjustmentApprovalPending ? (
        <p className="admin-inventory-note" role="status">
          Stock adjustment submitted for approval. No inventory movement is posted until approval
          and trusted execution complete.
        </p>
      ) : null}
      {mutationErrorText ? (
        <p className="admin-inventory-note" role="alert">
          {mutationErrorText}
        </p>
      ) : null}
      <section className="admin-inventory-summary" aria-label="Inventory summary">
        <div>
          <span>Total items</span>
          <strong>{counts.total}</strong>
        </div>
        <div>
          <span>Thresholds not set</span>
          <strong>{counts.unconfigured}</strong>
        </div>
        <div>
          <span>Low stock</span>
          <strong>{counts.lowStock}</strong>
        </div>
        <div>
          <span>Out of stock</span>
          <strong>{counts.outOfStock}</strong>
        </div>
      </section>
      {definitionOpen && canManageDefinitions ? (
        <InventoryDefinitionEditor
          item={items.find((item) => item.id === definitionItemId) ?? null}
          pending={inventory.manageDefinition.isPending}
          onClose={() => setDefinitionOpen(false)}
          onCommand={(input, onSuccess) =>
            inventory.manageDefinition.mutate(input, {
              onSuccess: (result) => {
                if (!result.ok) return;
                onSuccess(result.entityId);
                if (input.type === 'item.create' && result.entityId)
                  navigate(detailPath('/inventory', result.entityId));
              },
            })
          }
        />
      ) : mode === 'stocktake-history' && canStocktake ? (
        <section className="admin-inventory-workflow" aria-labelledby="stocktake-history-title">
          <div className="admin-inventory-workflow__header">
            <div>
              <p className="admin-page__eyebrow">After-shift physical counts</p>
              <h2 id="stocktake-history-title">Stock count history</h2>
            </div>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setMode('detail')}
            >
              Back to inventory
            </button>
          </div>
          {inventory.stocktakeSessionsQuery.isError ? (
            <p role="alert">Could not verify persisted count history. No changes were made.</p>
          ) : inventory.stocktakeSessionsQuery.isLoading ? (
            <p role="status">Loading authoritative count history…</p>
          ) : inventory.stocktakeSessionsQuery.data?.sessions.length ? (
            <div className="admin-inventory-transfer-list">
              {inventory.stocktakeSessionsQuery.data.sessions.map((session) => (
                <article className="admin-inventory-transfer-row" key={session.stocktakeId}>
                  <div>
                    <strong>
                      {session.status} · {session.lines.length} items
                    </strong>
                    <small>Started {new Date(session.startedAt).toLocaleString('en-GB')}</small>
                    {session.stale ? (
                      <span role="status">Stale snapshot — reconcile before a new count</span>
                    ) : null}
                    {session.postedAt ? (
                      <small>Posted {new Date(session.postedAt).toLocaleString('en-GB')}</small>
                    ) : null}
                    {session.cancelledAt ? (
                      <small>
                        Cancelled {new Date(session.cancelledAt).toLocaleString('en-GB')}
                      </small>
                    ) : null}
                  </div>
                  {session.status === 'DRAFT' ? (
                    <div className="admin-inventory-page-actions">
                      <button
                        className="admin-secondary-button"
                        type="button"
                        onClick={() => resumeStocktake(session)}
                      >
                        Resume draft
                      </button>
                      <button
                        className="admin-secondary-button"
                        type="button"
                        disabled={inventory.cancelStocktakeDraft.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              'Cancel this saved physical count without altering inventory?',
                            )
                          )
                            return;
                          inventory.cancelStocktakeDraft.mutate(session.stocktakeId);
                        }}
                      >
                        Cancel draft
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="admin-inventory-muted">No recorded stock counts for this shop.</p>
          )}
        </section>
      ) : mode === 'stocktake-select' ? (
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
                  disabled={inventory.beginStocktake.isPending || !stocktakeAllowed}
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
      ) : mode === 'master-bindings' && canManageMasterBindings ? (
        <InventoryMasterBindingPanel
          shopId={shopId}
          items={items}
          onBack={() => setMode('detail')}
        />
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
          key={stocktakeSnapshot.stocktakeId}
          items={items}
          snapshot={stocktakeSnapshot}
          initialActualByItem={stocktakeSavedValues}
          stale={stocktakeStale}
          saving={inventory.saveStocktakeDraft.isPending}
          pending={inventory.postStocktake.isPending || !stocktakeAllowed}
          onBack={() => {
            setStocktakeSnapshot(null);
            setMode('detail');
          }}
          onSaveDraft={(lines, onSaved) => {
            if (!stocktakeAllowed || stocktakeStale) return;
            inventory.saveStocktakeDraft.mutate(
              {
                stocktakeId: stocktakeSnapshot.stocktakeId,
                expectedRevision: stocktakeRevision,
                lines,
              },
              {
                onSuccess: (result) => {
                  if (result.ok && result.draftRevision !== undefined)
                    setStocktakeRevision(result.draftRevision);
                  onSaved();
                },
              },
            );
          }}
          onCancelDraft={() =>
            inventory.cancelStocktakeDraft.mutate(stocktakeSnapshot.stocktakeId, {
              onSuccess: () => {
                setStocktakeSnapshot(null);
                setMode('detail');
              },
            })
          }
          onSubmit={(lines) => {
            if (!stocktakeAllowed || stocktakeStale) return;
            inventory.postStocktake.mutate(
              { stocktakeId: stocktakeSnapshot.stocktakeId, lines },
              {
                onSuccess: () => {
                  setStocktakeSnapshot(null);
                  setMode('detail');
                },
              },
            );
          }}
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
          cancelling={inventory.cancelTransfer.isPending}
          onBack={() => setMode('detail')}
          onSend={(input) => inventory.sendTransfer.mutate(input)}
          onReceive={(transferId) => inventory.receiveTransfer.mutate(transferId)}
          onCancelTransfer={(transferId) => inventory.cancelTransfer.mutate(transferId)}
        />
      ) : (
        <ResponsiveMasterDetail
          className="admin-inventory-master-detail"
          listLabel="Inventory items"
          detailLabel="Inventory item detail"
          detailActive={selectedItemId !== null}
          backHref="/inventory"
          list={
            <div className="admin-inventory-list">
              <div className="admin-inventory-filter-pills" aria-label="Inventory stock filters">
                {(
                  [
                    ['all', 'All items', counts.total],
                    ['in', 'In stock', counts.inStock],
                    ['low', 'Low stock', counts.lowStock],
                    ['out', 'Out of stock', counts.outOfStock],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    key={value}
                    type="button"
                    className={statusFilter === value ? 'is-selected' : ''}
                    aria-pressed={statusFilter === value}
                    onClick={() => {
                      setStatusFilter(value);
                      setPage(1);
                    }}
                  >
                    {label} <span>{count}</span>
                  </button>
                ))}
              </div>
              <div className="admin-inventory-list-controls">
                <label className="admin-inventory-search">
                  <span className="sr-only">Search inventory items</span>
                  <input
                    type="search"
                    value={search}
                    placeholder="Search inventory items…"
                    onChange={(event) => {
                      setSearch(event.currentTarget.value);
                      setPage(1);
                    }}
                  />
                </label>
                <label>
                  <span className="sr-only">Sort inventory</span>
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.currentTarget.value as InventorySort);
                      setPage(1);
                    }}
                  >
                    <option value="name">Name (A–Z)</option>
                    <option value="available-desc">Available (high to low)</option>
                    <option value="priority">Stock priority</option>
                  </select>
                </label>
              </div>
              <div className="admin-inventory-table-header" aria-hidden="true">
                <span>Item</span>
                <span>Base unit</span>
                <span>On hand</span>
                <span>Reserved</span>
                <span>Available</span>
                <span>Status</span>
              </div>
              {items.length === 0 ? (
                <EmptyState
                  title="No inventory items"
                  description="Inventory configuration for this shop is empty."
                />
              ) : display.total === 0 ? (
                <EmptyState
                  title="No matching items"
                  description="Try changing the search or stock status filter."
                />
              ) : (
                display.rows.map((item) => {
                  const status = inventoryStatus(item);
                  const statusText =
                    status === 'OUT_OF_STOCK'
                      ? 'Out of stock'
                      : status === 'LOW_STOCK'
                        ? 'Low stock'
                        : status === 'ARCHIVED'
                          ? 'Archived'
                          : status === 'UNCONFIGURED'
                            ? 'Threshold not set'
                            : 'In stock';
                  const formatted = (micros: number) =>
                    new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(
                      micros / 1_000_000,
                    );
                  return (
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
                      <span>{item.unitLabel}</span>
                      <span>{formatted(item.onHandMicros)}</span>
                      <span>{formatted(item.reservedMicros)}</span>
                      <span>{formatted(item.availableMicros)}</span>
                      <span
                        className={`admin-inventory-status admin-inventory-status--${status.toLowerCase()}`}
                      >
                        {statusText}
                      </span>
                    </button>
                  );
                })
              )}
              <div className="admin-inventory-pagination">
                <span>
                  Showing {display.total === 0 ? 0 : (display.page - 1) * 25 + 1}–
                  {Math.min(display.page * 25, display.total)} of {display.total} items
                </span>
                <div>
                  <button
                    type="button"
                    aria-label="Previous inventory page"
                    disabled={display.page <= 1}
                    onClick={() => setPage(display.page - 1)}
                  >
                    ‹
                  </button>
                  <span>
                    Page {display.page} of {display.totalPages}
                  </span>
                  <button
                    type="button"
                    aria-label="Next inventory page"
                    disabled={display.page >= display.totalPages}
                    onClick={() => setPage(display.page + 1)}
                  >
                    ›
                  </button>
                </div>
              </div>
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
                  shopName={workspace.shops?.find((shop) => shop.id === shopId)?.name}
                  actions={
                    canManageDefinitions || (canAdjust && selectedItem.active) ? (
                      <>
                        {canManageDefinitions ? (
                          <button
                            className="admin-secondary-button"
                            type="button"
                            onClick={() => {
                              setDefinitionItemId(selectedItem.id);
                              setDefinitionOpen(true);
                            }}
                          >
                            Edit item
                          </button>
                        ) : null}
                        {canAdjust && selectedItem.active ? (
                          <button
                            className="admin-secondary-button"
                            type="button"
                            onClick={() => setItemAction('adjust')}
                          >
                            Adjust stock
                          </button>
                        ) : null}
                        {canAdjust && selectedItem.active ? (
                          <button
                            className="admin-secondary-button"
                            type="button"
                            onClick={() => setItemAction('waste')}
                          >
                            Record waste
                          </button>
                        ) : null}
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
                        {
                          onSuccess: (result) => {
                            setAdjustmentApprovalPending(
                              result.ok && result.state === 'PENDING_APPROVAL',
                            );
                            setItemAction(null);
                          },
                        },
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
