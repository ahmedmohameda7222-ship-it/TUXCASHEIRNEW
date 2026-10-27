import type { AdminCustomerSummary } from '@tux/admin-contracts';
import { useMemo, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';

type Segment = AdminCustomerSummary['segments'][number];
type LoyaltyFilter = 'all' | 'points' | 'none';
type DirectorySort = 'name' | 'orders' | 'recent';
const PAGE_SIZE = 10;

function customerName(customer: AdminCustomerSummary): string {
  return customer.displayName?.trim() || 'Unnamed customer';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toLocaleUpperCase())
    .join('');
}

function moneyFromMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const pounds = new Intl.NumberFormat('en-EG').format(abs / 100n);
  const pennies = String(abs % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}EGP ${pounds}.${pennies}`;
}

function dateText(date: string | null): string {
  if (!date) return '—';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : parsed.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
}

export function CustomerDirectory({
  customers,
  selectedId,
  query,
  onQueryChange,
  onSelect,
  loading,
  fetching,
  error,
  onRetry,
}: {
  customers: readonly AdminCustomerSummary[];
  selectedId: string | null;
  query: string;
  onQueryChange(value: string): void;
  onSelect(customerId: string): void;
  loading: boolean;
  fetching: boolean;
  error: boolean;
  onRetry(): void;
}) {
  const [segment, setSegment] = useState<Segment | 'all'>('all');
  const [loyalty, setLoyalty] = useState<LoyaltyFilter>('all');
  const [sort, setSort] = useState<DirectorySort>('name');
  const [page, setPage] = useState(0);
  const segments = useMemo(() => {
    const names = customers.flatMap((customer) => customer.segments);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [customers]);
  const filtered = useMemo(() => {
    const matches = customers.filter((customer) => {
      if (segment !== 'all' && !customer.segments.includes(segment)) return false;
      if (loyalty === 'points' && customer.loyaltyBalance <= 0) return false;
      if (loyalty === 'none' && customer.loyaltyBalance > 0) return false;
      return true;
    });
    return matches.sort((a, b) => {
      const nameDifference = customerName(a).localeCompare(customerName(b));
      if (sort === 'orders') return b.orderCount - a.orderCount || nameDifference;
      if (sort === 'recent') {
        return (b.lastOrderAt ?? '').localeCompare(a.lastOrderAt ?? '') || nameDifference;
      }
      return nameDifference || a.id.localeCompare(b.id);
    });
  }, [customers, segment, loyalty, sort]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const start = currentPage * PAGE_SIZE;
  const rows = filtered.slice(start, start + PAGE_SIZE);

  return (
    <section className="admin-customers-directory" aria-label="Customer directory">
      <div className="admin-customers-directory__toolbar">
        <label className="admin-customers-directory__search">
          <span className="sr-only">Search customers</span>
          <input
            type="search"
            aria-label="Search customers"
            value={query}
            placeholder="Search by name or phone..."
            onChange={(event) => {
              setPage(0);
              onQueryChange(event.currentTarget.value);
            }}
          />
        </label>
        <select
          aria-label="All segments (loaded results)"
          value={segment}
          onChange={(event) => {
            setPage(0);
            setSegment(event.currentTarget.value as Segment | 'all');
          }}
        >
          <option value="all">All segments</option>
          {segments.map((value) => (
            <option value={value} key={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="All loyalty (loaded results)"
          value={loyalty}
          onChange={(event) => {
            setPage(0);
            setLoyalty(event.currentTarget.value as LoyaltyFilter);
          }}
        >
          <option value="all">All loyalty</option>
          <option value="points">With points</option>
          <option value="none">No points</option>
        </select>
        <select
          aria-label="Sort loaded customers"
          value={sort}
          onChange={(event) => {
            setPage(0);
            setSort(event.currentTarget.value as DirectorySort);
          }}
        >
          <option value="name">Name (A – Z)</option>
          <option value="orders">Most orders</option>
          <option value="recent">Last order</option>
        </select>
      </div>
      <p className="admin-customers-directory__scope">
        Filters and sorting apply to loaded customers only.
        {fetching && !loading ? ' Updating…' : null}
      </p>
      <div className="admin-customers-directory__columns" aria-hidden="true">
        <span>Name</span>
        <span>Phone</span>
        <span>Orders</span>
        <span>Total spent</span>
        <span>Loyalty</span>
        <span>Segment</span>
        <span>Last order</span>
      </div>
      {loading ? <LoadingState title="Loading customers" /> : null}
      {error ? (
        <ErrorState
          title="Customers could not be loaded"
          action={
            <button className="admin-secondary-button" type="button" onClick={onRetry}>
              Retry
            </button>
          }
        />
      ) : null}
      {!loading && !error && customers.length === 0 ? (
        <EmptyState title="No matching customers" description="Try another name or phone number." />
      ) : null}
      {!loading && !error && customers.length > 0 && filtered.length === 0 ? (
        <p className="admin-customers-directory__empty">
          No customers match these loaded-data filters.
        </p>
      ) : null}
      {!loading && !error
        ? rows.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className={
                customer.id === selectedId ? 'admin-customer-row is-selected' : 'admin-customer-row'
              }
              aria-current={customer.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(customer.id)}
            >
              <span className="admin-customer-row__identity">
                <span className="admin-customer-row__initials" aria-hidden="true">
                  {initials(customerName(customer))}
                </span>
                <span className="admin-customer-row__name">
                  <strong>{customerName(customer)}</strong>
                  <small>{customer.normalizedPhone}</small>
                </span>
              </span>
              <span className="admin-customer-row__phone">{customer.normalizedPhone}</span>
              <span className="admin-customer-row__orders">
                <strong>{customer.orderCount}</strong>
                <small> orders</small>
              </span>
              <span className="admin-customer-row__spend">
                {moneyFromMinor(customer.lifetimeSpendMinor)}
              </span>
              <span className="admin-customer-row__loyalty">
                {customer.loyaltyBalance} pts
              </span>
              <span className="admin-customer-row__segment">
                {customer.segments[0] ?? '—'}
              </span>
              <span className="admin-customer-row__last">{dateText(customer.lastOrderAt)}</span>
            </button>
          ))
        : null}
      {!loading && !error ? (
        <footer className="admin-customers-directory__footer">
          <span>
            {filtered.length === 0 ? 'Showing 0' : `Showing ${start + 1}–${start + rows.length}`}
            {' of '}
            {filtered.length} loaded customers
          </span>
          <div className="admin-customers-directory__pager">
            <button
              type="button"
              aria-label="Previous loaded customer page"
              disabled={currentPage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              ‹
            </button>
            <span aria-label="Loaded customer page">{currentPage + 1}</span>
            <button
              type="button"
              aria-label="Next loaded customer page"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            >
              ›
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}
