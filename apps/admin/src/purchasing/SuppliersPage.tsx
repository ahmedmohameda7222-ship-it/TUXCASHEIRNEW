import { useState } from 'react';

import type { AdminSupplier } from '@tux/admin-contracts';

export function SuppliersPage({
  suppliers,
  pending,
  onCreate,
}: {
  suppliers: readonly AdminSupplier[];
  pending: boolean;
  onCreate(input: {
    name: string;
    contactName: string | null;
    phone: string | null;
    email: string | null;
  }): void;
}) {
  const [name, setName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  return (
    <section aria-labelledby="purchasing-suppliers-heading">
      <h2 id="purchasing-suppliers-heading">Suppliers</h2>
      <div className="admin-card-grid">
        {suppliers.map((supplier) => (
          <article className="admin-card" key={supplier.id}>
            <strong>{supplier.name}</strong>
            <span>{supplier.contactName ?? 'No contact name'}</span>
            <span>{supplier.phone ?? supplier.email ?? 'No contact details'}</span>
          </article>
        ))}
      </div>
      <form
        className="admin-form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          onCreate({
            name: trimmed,
            contactName: contactName.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
          });
          setName('');
          setContactName('');
          setPhone('');
          setEmail('');
        }}
      >
        <label>
          Supplier name
          <input value={name} onChange={(event) => setName(event.currentTarget.value)} />
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
        <button className="admin-secondary-button" type="submit" disabled={pending}>
          Add supplier
        </button>
      </form>
    </section>
  );
}
