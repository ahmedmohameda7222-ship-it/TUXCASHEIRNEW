import type { AdminCustomerDetail, AdminCustomerSummary } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} EGP`;
}

function CustomerSnapshot({
  label,
  customer,
}: {
  label: string;
  customer: Pick<
    AdminCustomerSummary,
    | 'displayName'
    | 'normalizedPhone'
    | 'orderCount'
    | 'lifetimeSpendMinor'
    | 'loyaltyBalance'
    | 'lastOrderAt'
    | 'segments'
  >;
}) {
  return (
    <article className="admin-card" aria-label={label}>
      <p className="admin-page__eyebrow">{label}</p>
      <strong>{customer.displayName ?? 'Unnamed customer'}</strong>
      <span>{customer.normalizedPhone}</span>
      <dl>
        <dt>Orders</dt>
        <dd>{customer.orderCount}</dd>
        <dt>Lifetime spend</dt>
        <dd>{money(customer.lifetimeSpendMinor)}</dd>
        <dt>Loyalty balance</dt>
        <dd>{customer.loyaltyBalance} points</dd>
        <dt>Last order</dt>
        <dd>{customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString() : 'No orders yet'}</dd>
        <dt>Customer groups</dt>
        <dd>{customer.segments.length > 0 ? customer.segments.join(', ') : 'None'}</dd>
      </dl>
    </article>
  );
}

export function CustomerMergeDialog({
  open,
  survivor,
  candidates,
  search,
  loading,
  error,
  pending,
  onSearchChange,
  onClose,
  onConfirm,
}: {
  open: boolean;
  survivor: AdminCustomerDetail;
  candidates: readonly AdminCustomerSummary[];
  search: string;
  loading: boolean;
  error: boolean;
  pending: boolean;
  onSearchChange(value: string): void;
  onClose(): void;
  onConfirm(candidate: AdminCustomerSummary): void;
}) {
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const candidate = useMemo(
    () => candidates.find((item) => item.id === candidateId) ?? null,
    [candidateId, candidates],
  );

  function close() {
    if (pending) return;
    setCandidateId(null);
    setConfirmed(false);
    onClose();
  }

  return (
    <AdminDialog
      open={open}
      variant="sheet"
      title="Merge customer"
      description="Choose a duplicate customer to merge into the surviving profile."
      destructive
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <label className="admin-field">
        <span>Search merge candidates</span>
        <input
          autoFocus
          value={search}
          placeholder="Name or phone"
          disabled={pending}
          onChange={(event) => {
            setCandidateId(null);
            setConfirmed(false);
            onSearchChange(event.target.value);
          }}
        />
      </label>

      {loading ? <LoadingState title="Searching customers" /> : null}
      {error ? <ErrorState title="Customer search failed" description="Try the search again." /> : null}
      {!loading && !error && candidates.length === 0 ? (
        <EmptyState title="No merge candidates" description="Try another name or phone number." />
      ) : null}
      {!loading && !error && candidates.length > 0 ? (
        <div className="admin-inventory-list" aria-label="Merge candidates">
          {candidates.map((item) => (
            <button
              className={item.id === candidateId ? 'admin-inventory-row is-selected' : 'admin-inventory-row'}
              type="button"
              key={item.id}
              aria-pressed={item.id === candidateId}
              disabled={pending}
              onClick={() => {
                setCandidateId(item.id);
                setConfirmed(false);
              }}
            >
              <span>
                <strong>{item.displayName ?? 'Unnamed customer'}</strong>
                <small>{item.normalizedPhone}</small>
              </span>
              <span>{item.orderCount} orders</span>
            </button>
          ))}
        </div>
      ) : null}

      {candidate ? (
        <section aria-labelledby="customer-merge-review-title">
          <h3 id="customer-merge-review-title">Review merge</h3>
          <div className="admin-card-grid">
            <CustomerSnapshot label="Surviving customer" customer={survivor} />
            <CustomerSnapshot label="Customer to merge" customer={candidate} />
          </div>
          <p>
            The surviving customer keeps their profile. Order history, linked shop history, addresses and loyalty history are preserved or transferred according to the existing merge rules.
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={pending}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{' '}
            I reviewed both customers and want to merge them.
          </label>
          <div className="admin-inventory-page-actions">
            <button className="admin-secondary-button" type="button" disabled={pending} onClick={close}>
              Cancel
            </button>
            <button
              className="admin-destructive-button"
              type="button"
              disabled={pending || !confirmed}
              onClick={() => onConfirm(candidate)}
            >
              {pending ? 'Merging…' : 'Merge customer'}
            </button>
          </div>
        </section>
      ) : null}
    </AdminDialog>
  );
}
