import { useState } from 'react';

import type { AdminSupplier } from '@tux/admin-contracts';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import './suppliers.css';

export function SuppliersPage({
  suppliers,
  canManage,
  canManageLifecycle,
  pending,
  onCreate,
  onManage,
}: {
  suppliers: readonly AdminSupplier[];
  canManage: boolean;
  canManageLifecycle: boolean;
  pending: boolean;
  onManage(
    input: {
      type: 'supplier.update' | 'supplier.archive' | 'supplier.restore';
      supplierId: string;
      expectedVersion: number;
      payload: {
        name?: string;
        contactName?: string | null;
        phone?: string | null;
        email?: string | null;
      };
    },
    onSuccess: () => void,
  ): void;
  onCreate(
    input: { name: string; contactName: string | null; phone: string | null; email: string | null },
    onSuccess: () => void,
  ): void;
}) {
  const [open, setOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AdminSupplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<AdminSupplier | null>(null);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;
  const visibleSuppliers = suppliers.filter((supplier) => {
    if (statusFilter === 'active' && !supplier.active) return false;
    if (statusFilter === 'archived' && supplier.active) return false;
    return [supplier.name, supplier.contactName, supplier.phone, supplier.email]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search.trim().toLowerCase()));
  });

  function beginEdit(supplier: AdminSupplier) {
    setEditingSupplier(supplier);
    setName(supplier.name);
    setContactName(supplier.contactName ?? '');
    setPhone(supplier.phone ?? '');
    setEmail(supplier.email ?? '');
    setOpen(true);
  }

  function clearDraft() {
    setName('');
    setContactName('');
    setPhone('');
    setEmail('');
  }

  return (
    <section aria-labelledby="purchasing-suppliers-heading">
      <div className="admin-section-heading">
        <h2 id="purchasing-suppliers-heading">Suppliers</h2>
        {canManage ? (
          <button
            className="admin-secondary-button"
            type="button"
            onClick={() => {
              clearDraft();
              setEditingSupplier(null);
              setOpen(true);
            }}
          >
            Add supplier
          </button>
        ) : null}
      </div>
      <div className="admin-purchasing-supplier-filters">
        <label className="admin-field">
          <span>Search suppliers</span>
          <input
            type="search"
            value={search}
            placeholder="Supplier, contact, phone or email"
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </label>
        <label className="admin-field">
          <span>Filter suppliers by status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as 'all' | 'active' | 'archived')}>
            <option value="all">All suppliers</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button className="admin-purchasing-reset" type="button" onClick={() => { setSearch(''); setStatusFilter('all'); }}>Reset filters</button>
      </div>
      <div className="admin-purchasing-filter-summary">
        <span>{visibleSuppliers.length} matching suppliers from {suppliers.length} loaded records</span>
      </div>
      <div className="admin-supplier-directory" role="list">
        <div className="admin-supplier-directory__heading" aria-hidden="true"><span>Supplier</span><span>Contact</span><span>Phone</span><span>Email</span><span>Status</span></div>
        {visibleSuppliers.map((supplier) => (
          <article className={selectedSupplierId === supplier.id ? "admin-supplier-card is-selected" : "admin-supplier-card"} role="listitem" key={supplier.id}>
            <header className="admin-supplier-card__identity">
              <button className="admin-supplier-select" type="button" aria-pressed={selectedSupplierId === supplier.id} onClick={() => setSelectedSupplierId(supplier.id)}>{supplier.name}</button>
              <span
                className={
                  supplier.active
                    ? 'admin-supplier-card__status'
                    : 'admin-supplier-card__status is-archived'
                }
              >
                {supplier.active ? 'Active' : 'Archived'}
              </span>
            </header>
            <dl className="admin-supplier-card__facts">
              <div>
                <dt>Contact</dt>
                <dd>{supplier.contactName ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{supplier.phone ?? 'Not provided'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{supplier.email ?? 'Not provided'}</dd>
              </div>
            </dl>
            {canManageLifecycle && typeof supplier.version === 'number' ? (
              <div
                className="admin-supplier-card__actions"
                role="group"
                aria-label={'Actions for ' + supplier.name}
              >
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => beginEdit(supplier)}
                >
                  Edit {supplier.name}
                </button>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (supplier.active) {
                      setArchiveTarget(supplier);
                    } else {
                      onManage(
                        {
                          type: 'supplier.restore',
                          supplierId: supplier.id,
                          expectedVersion: supplier.version!,
                          payload: {},
                        },
                        () => undefined,
                      );
                    }
                  }}
                >
                  {supplier.active ? 'Archive' : 'Restore'} {supplier.name}
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {visibleSuppliers.length === 0 ? <p className="admin-purchasing-empty">{suppliers.length === 0 ? 'No suppliers yet' : 'No suppliers match these filters.'}</p> : null}
      </div>
      {selectedSupplier ? (
        <aside className="admin-purchasing-supplier-inspector" aria-label="Selected supplier detail">
          <div className="admin-section-heading"><h3>{selectedSupplier.name}</h3><span>{selectedSupplier.active ? 'Active' : 'Archived'}</span></div>
          <dl>
            <div><dt>Contact</dt><dd>{selectedSupplier.contactName ?? 'Not provided'}</dd></div>
            <div><dt>Phone</dt><dd>{selectedSupplier.phone ?? 'Not provided'}</dd></div>
            <div><dt>Email</dt><dd>{selectedSupplier.email ?? 'Not provided'}</dd></div>
          </dl>
          <button className="admin-secondary-button" type="button" onClick={() => setSelectedSupplierId(null)}>Close supplier details</button>
        </aside>
      ) : null}
      <AdminDialog
        open={archiveTarget !== null}
        destructive
        title="Archive supplier?"
        description={
          archiveTarget
            ? 'Archive ' + archiveTarget.name + '? Existing purchase orders remain unchanged.'
            : 'Confirm supplier archive.'
        }
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !pending) setArchiveTarget(null);
        }}
        footer={
          <div className="admin-supplier-card__confirm">
            <button
              className="admin-secondary-button"
              type="button"
              disabled={pending}
              onClick={() => setArchiveTarget(null)}
            >
              Cancel
            </button>
            <button
              className="admin-destructive-button"
              type="button"
              disabled={pending || archiveTarget === null}
              onClick={() => {
                if (archiveTarget === null || typeof archiveTarget.version !== 'number') return;
                onManage(
                  {
                    type: 'supplier.archive',
                    supplierId: archiveTarget.id,
                    expectedVersion: archiveTarget.version,
                    payload: {},
                  },
                  () => setArchiveTarget(null),
                );
              }}
            >
              Archive supplier
            </button>
          </div>
        }
      >
        <p>
          This removes the supplier from active purchasing choices. It does not delete historical
          orders.
        </p>
      </AdminDialog>
      {canManage ? (
        <AdminDialog
          open={open}
          variant="sheet"
          title={editingSupplier ? 'Edit supplier' : 'Add supplier'}
          description={
            editingSupplier
              ? 'Update this business supplier without changing past purchase orders.'
              : 'Create a supplier record for purchasing at this shop.'
          }
          onOpenChange={(nextOpen) => {
            if (!pending) setOpen(nextOpen);
          }}
        >
          <form
            className="admin-form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              const payload = {
                name: trimmed,
                contactName: contactName.trim() || null,
                phone: phone.trim() || null,
                email: email.trim() || null,
              };
              const onSuccess = () => {
                clearDraft();
                setEditingSupplier(null);
                setOpen(false);
              };
              if (
                editingSupplier &&
                canManageLifecycle &&
                typeof editingSupplier.version === 'number'
              ) {
                onManage(
                  {
                    type: 'supplier.update',
                    supplierId: editingSupplier.id,
                    expectedVersion: editingSupplier.version,
                    payload,
                  },
                  onSuccess,
                );
              } else if (!editingSupplier) {
                onCreate(payload, onSuccess);
              }
            }}
          >
            <FormField id="supplier-name" label="Supplier name" required>
              <input
                id="supplier-name"
                autoFocus
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </FormField>
            <FormField id="supplier-contact" label="Contact name">
              <input
                id="supplier-contact"
                value={contactName}
                onChange={(event) => setContactName(event.currentTarget.value)}
              />
            </FormField>
            <FormField id="supplier-phone" label="Phone" hint="Optional contact number">
              <input
                id="supplier-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.currentTarget.value)}
              />
            </FormField>
            <FormField id="supplier-email" label="Email">
              <input
                id="supplier-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </FormField>
            <div className="admin-inline-actions">
              <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" pending={pending} disabled={!name.trim()}>
                {pending ? 'Saving…' : editingSupplier ? 'Save supplier' : 'Add supplier'}
              </Button>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </section>
  );
}
