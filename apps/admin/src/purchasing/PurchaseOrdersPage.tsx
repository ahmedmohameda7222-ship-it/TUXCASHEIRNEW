import type {
  AdminPurchaseOrder,
  AdminPurchasingInventoryItem,
  AdminSupplier,
} from '@tux/admin-contracts';
import { useMemo, useRef, useState } from 'react';

import { AdminDialog } from '../components/overlay/AdminDialog';
import {
  calculatePurchaseOrderSubtotalMinor,
  parsePurchaseDecimalMicros,
  parsePurchaseMoneyMinor,
  validatePurchaseOrderLines,
} from './purchaseOrderDraft';

function statusLabel(status: AdminPurchaseOrder['status']): string {
  return status
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

type DraftLine = {
  key: number;
  inventoryItemId: string;
  purchaseUnitLabel: string;
  quantity: string;
  unitCost: string;
};

function newLine(key: number, items: readonly AdminPurchasingInventoryItem[]): DraftLine {
  const first = items[0];
  return {
    key,
    inventoryItemId: first?.id ?? '',
    purchaseUnitLabel: first?.purchaseUnits[0]?.label ?? first?.unitLabel ?? '',
    quantity: '',
    unitCost: '',
  };
}

function formatEgpMinor(minor: number): string {
  const amount = BigInt(minor);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

export function PurchaseOrdersPage({
  purchaseOrders,
  suppliers,
  inventoryItems,
  selectedId,
  canManage,
  pending,
  onSelect,
  onCreate,
}: {
  purchaseOrders: readonly AdminPurchaseOrder[];
  suppliers: readonly AdminSupplier[];
  inventoryItems: readonly AdminPurchasingInventoryItem[];
  selectedId: string | null;
  canManage: boolean;
  pending: boolean;
  onSelect(id: string): void;
  onCreate(
    input: {
      supplierId: string;
      reference: string | null;
      expectedDeliveryDate: string | null;
      lines: readonly {
        inventoryItemId: string;
        purchaseUnitLabel: string;
        orderedPurchaseUnitsMicros: number;
        expectedPurchaseUnitCostMinor: number;
      }[];
    },
    onSuccess: () => void,
  ): void;
}) {
  const activeSuppliers = useMemo(
    () => suppliers.filter((supplier) => supplier.active),
    [suppliers],
  );
  const firstSupplier = activeSuppliers[0]?.id ?? '';
  const [supplierId, setSupplierId] = useState(firstSupplier);
  const [reference, setReference] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const nextKey = useRef(2);
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine(1, inventoryItems)]);
  const [formError, setFormError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const visibleOrders = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return purchaseOrders
      .filter((order) => {
        if (statusFilter && order.status !== statusFilter) return false;
        if (supplierFilter && order.supplierId !== supplierFilter) return false;
        if (!normalized) return true;
        return [order.reference, order.id, order.supplierName]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLocaleLowerCase().includes(normalized));
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }, [purchaseOrders, search, statusFilter, supplierFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedOrders = visibleOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  function resetFilters() {
    setSearch('');
    setStatusFilter('');
    setSupplierFilter('');
    setPage(1);
  }


  const selectedSupplierId = activeSuppliers.some((supplier) => supplier.id === supplierId)
    ? supplierId
    : firstSupplier;

  const preparedLines = lines.map((line) => ({
    inventoryItemId: line.inventoryItemId,
    purchaseUnitLabel: line.purchaseUnitLabel,
    orderedPurchaseUnitsMicros: parsePurchaseDecimalMicros(line.quantity) ?? 0,
    expectedPurchaseUnitCostMinor: parsePurchaseMoneyMinor(line.unitCost) ?? -1,
  }));
  const lineError = validatePurchaseOrderLines(preparedLines, inventoryItems);
  const subtotal =
    lineError === null
      ? (() => {
          try {
            return calculatePurchaseOrderSubtotalMinor(preparedLines);
          } catch {
            return null;
          }
        })()
      : null;

  function resetForm() {
    setReference('');
    setExpectedDate('');
    setLines([newLine(nextKey.current++, inventoryItems)]);
    setFormError(null);
    setCreateOpen(false);
  }

  function updateLine(key: number, changes: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    );
    setFormError(null);
  }

  return (
    <section aria-labelledby="purchase-orders-heading">
      <div className="admin-section-heading">
        <h2 id="purchase-orders-heading">Purchase orders</h2>
        {canManage ? (
          <button
            className="admin-primary-button"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            New purchase order
          </button>
        ) : null}
      </div>
      <div className="admin-purchasing-directory">
        <div className="admin-purchasing-filters">
          <label className="admin-purchasing-search">
            <span className="sr-only">Search purchase orders</span>
            <input
              aria-label="Search purchase orders"
              type="search"
              placeholder="PO number or supplier"
              value={search}
              onChange={(event) => { setSearch(event.currentTarget.value); setPage(1); }}
            />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => { setStatusFilter(event.currentTarget.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              {(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const).map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by supplier</span>
            <select
              aria-label="Filter by supplier"
              value={supplierFilter}
              onChange={(event) => { setSupplierFilter(event.currentTarget.value); setPage(1); }}
            >
              <option value="">All suppliers</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-purchasing-filter-summary">
          <span>{visibleOrders.length} matching purchase orders from {purchaseOrders.length} loaded records</span>
          <button type="button" className="admin-purchasing-reset" onClick={resetFilters}>Reset filters</button>
        </div>
        <div className="admin-purchasing-list-heading" aria-hidden="true">
          <span>PO reference</span><span>Supplier</span><span>Expected delivery</span><span>Status</span>
        </div>
        <div className="admin-purchasing-list" aria-label="Purchase orders">
          {paginatedOrders.map((order) => (
            <button
              className={selectedId === order.id
                ? 'admin-purchasing-list-row is-selected'
                : 'admin-purchasing-list-row'}
              aria-current={selectedId === order.id ? 'true' : undefined}
              type="button"
              key={order.id}
              onClick={() => onSelect(order.id)}
            >
              <span className="admin-purchasing-row-reference">
                <strong>{order.reference?.trim() || `PO-${order.id.slice(0, 8).toUpperCase()}`}</strong>
                <small>{order.createdAt.slice(0, 10)}</small>
              </span>
              <span className="admin-purchasing-row-supplier">{order.supplierName}</span>
              <span className="admin-purchasing-row-date">{order.expectedDeliveryDate ?? 'Not set'}</span>
              <span><span className={`admin-purchasing-status is-${order.status.toLowerCase().replaceAll('_', '-')}`}>{statusLabel(order.status)}</span></span>
            </button>
          ))}
          {visibleOrders.length === 0 ? (
            <p className="admin-purchasing-empty">
              {purchaseOrders.length === 0 ? 'No purchase orders yet' : 'No purchase orders match these filters.'}
            </p>
          ) : null}
        </div>
        <div className="admin-purchasing-pager">
          <span>Showing {visibleOrders.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visibleOrders.length)} of {visibleOrders.length} loaded matches</span>
          <div>
            <button type="button" aria-label="Previous purchase order page" className="admin-secondary-button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span aria-live="polite">Page {currentPage} of {pageCount}</span>
            <button type="button" aria-label="Next purchase order page" className="admin-secondary-button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
          </div>
        </div>
      </div>
      {canManage ? (
        <AdminDialog
          open={createOpen}
          variant="sheet"
          size="wide"
          title="New purchase order"
          description="Choose a supplier and add one or more purchase-order lines."
          onOpenChange={(open) => {
            if (!pending) setCreateOpen(open);
          }}
        >
          <form
            className="admin-form-grid admin-po-builder"
            onSubmit={(event) => {
              event.preventDefault();
              const error = !selectedSupplierId
                ? 'Select a supplier.'
                : (lineError ?? (subtotal === null ? 'Order subtotal is too large.' : null));
              if (error) {
                setFormError(error);
                return;
              }
              onCreate(
                {
                  supplierId: selectedSupplierId,
                  reference: reference.trim() || null,
                  expectedDeliveryDate: expectedDate || null,
                  lines: preparedLines,
                },
                resetForm,
              );
            }}
          >
            <label>
              Supplier
              <select
                value={selectedSupplierId}
                onChange={(event) => setSupplierId(event.currentTarget.value)}
              >
                {activeSuppliers.map((supplier) => (
                  <option value={supplier.id} key={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reference
              <input
                value={reference}
                onChange={(event) => setReference(event.currentTarget.value)}
              />
            </label>
            <label>
              Expected delivery
              <input
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.currentTarget.value)}
              />
            </label>
            {lines.map((line, index) => {
              const item = inventoryItems.find(
                (candidate) => candidate.id === line.inventoryItemId,
              );
              const units = item?.purchaseUnits ?? [];
              return (
                <fieldset className="admin-form-grid" key={line.key}>
                  <legend>Line {index + 1}</legend>
                  <label>
                    Inventory item
                    <select
                      value={line.inventoryItemId}
                      onChange={(event) => {
                        const selected = inventoryItems.find(
                          (candidate) => candidate.id === event.currentTarget.value,
                        );
                        updateLine(line.key, {
                          inventoryItemId: selected?.id ?? '',
                          purchaseUnitLabel: selected?.purchaseUnits[0]?.label ?? '',
                        });
                      }}
                    >
                      {inventoryItems.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Purchase unit
                    <select
                      value={line.purchaseUnitLabel}
                      onChange={(event) =>
                        updateLine(line.key, { purchaseUnitLabel: event.currentTarget.value })
                      }
                    >
                      {units.map((unit) => (
                        <option key={unit.label} value={unit.label}>
                          {unit.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Quantity (purchase units)
                    <input
                      inputMode="decimal"
                      required
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, { quantity: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label>
                    Expected cost per purchase unit (EGP)
                    <input
                      inputMode="decimal"
                      required
                      value={line.unitCost}
                      onChange={(event) =>
                        updateLine(line.key, { unitCost: event.currentTarget.value })
                      }
                    />
                  </label>
                  {lines.length > 1 ? (
                    <button
                      className="admin-secondary-button"
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setLines((current) =>
                          current.filter((candidate) => candidate.key !== line.key),
                        );
                        setFormError(null);
                      }}
                    >
                      Remove line {index + 1}
                    </button>
                  ) : null}
                </fieldset>
              );
            })}
            <button
              className="admin-secondary-button"
              type="button"
              disabled={pending || lines.length >= 500 || inventoryItems.length === 0}
              onClick={() => {
                setLines((current) => [...current, newLine(nextKey.current++, inventoryItems)]);
                setFormError(null);
              }}
            >
              Add line
            </button>
            {formError ? <p role="alert">{formError}</p> : null}
            {subtotal !== null ? <p>Expected subtotal: {formatEgpMinor(subtotal)} EGP</p> : null}
            <button
              className="admin-primary-button"
              type="submit"
              disabled={pending || !selectedSupplierId || inventoryItems.length === 0}
            >
              Create purchase order
            </button>
            <button
              className="admin-secondary-button"
              type="button"
              disabled={pending}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
          </form>
        </AdminDialog>
      ) : null}
    </section>
  );
}
