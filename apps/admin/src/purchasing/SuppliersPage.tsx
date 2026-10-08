import { useState } from 'react';

import type { AdminSupplier } from '@tux/admin-contracts';
import { AdminDialog } from '../components/overlay/AdminDialog';

export function SuppliersPage({
  suppliers,
  canManage,
  pending,
  onCreate,
}: {
  suppliers: readonly AdminSupplier[];
  canManage: boolean;
  pending: boolean;
  onCreate(
    input: { name: string; contactName: string | null; phone: string | null; email: string | null },
    onSuccess: () => void,
  ): void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [search, setSearch] = useState('');
  const visibleSuppliers = suppliers.filter((supplier) =>
    [supplier.name, supplier.contactName, supplier.phone, supplier.email]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search.trim().toLowerCase())),
  );

  function clearDraft() {
    setName('');
    setContactName('');
    setPhone('');
    setEmail('');
  }

  return (
    <section aria-labelledby="purchasing-suppliers-heading">
      <div className="admin-catalog-editor__section-heading">
        <h2 id="purchasing-suppliers-heading">Suppliers</h2>
        {canManage ? (
          <button className="admin-secondary-button" type="button" onClick={() => setOpen(true)}>
            Add supplier
          </button>
        ) : null}
      </div>
      <label className="admin-field">
        <span>Search suppliers</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </label>
      <div className="admin-card-grid">
        {visibleSuppliers.map((supplier) => (
          <article className="admin-card" key={supplier.id}>
            <strong>{supplier.name}</strong>
            <span>{supplier.contactName ?? 'No contact name'}</span>
            <span>{supplier.phone ?? supplier.email ?? 'No contact details'}</span>
          </article>
        ))}
      </div>
      {canManage ? (
        <AdminDialog
          open={open}
          variant="sheet"
          title="Add supplier"
          description="Create a supplier record for purchasing at this shop."
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
              onCreate(
                {
                  name: trimmed,
                  contactName: contactName.trim() || null,
                  phone: phone.trim() || null,
                  email: email.trim() || null,
                },
                () => {
                  clearDraft();
                  setOpen(false);
                },
              );
            }}
          >
            <label>
              Supplier name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label>
              Contact name
              <input
                value={contactName}
                onChange={(event) => setContactName(event.currentTarget.value)}
              />
            </label>
            <label>
              Phone
              <input value={phone} onChange={(event) => setPhone(event.currentTarget.value)} />
            </label>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
            </label>
            <div className="admin-inventory-page-actions">
              <button
                className="admin-secondary-button"
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="admin-primary-button"
                type="submit"
                disabled={pending || !name.trim()}
              >
                {pending ? 'Adding…' : 'Add supplier'}
              </button>
            </div>
          </form>
        </AdminDialog>
      ) : null}
    </section>
  );
}
