import type { AdminCustomerDetail } from '@tux/admin-contracts';

import { SegmentsPage } from './SegmentsPage';

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} EGP`;
}

export function CustomerDetailPage({
  customer,
  canMerge,
  onMerge,
}: {
  customer: AdminCustomerDetail;
  canMerge: boolean;
  onMerge(): void;
}) {
  return (
    <article aria-label="Customer detail">
      <header>
        <p className="admin-entry__eyebrow">Canonical customer</p>
        <h2>{customer.displayName ?? 'Unnamed customer'}</h2>
        <p>{customer.normalizedPhone}</p>
      </header>

      <dl>
        <div>
          <dt>Order history</dt>
          <dd>
            {customer.orderCount} orders · {money(customer.lifetimeSpendMinor)}
          </dd>
        </div>
        <div>
          <dt>Delivery orders</dt>
          <dd>{customer.deliveryOrderCount}</dd>
        </div>
        <div>
          <dt>Loyalty balance</dt>
          <dd>{customer.loyaltyBalance} points</dd>
        </div>
      </dl>

      <section aria-label="Linked shops">
        <h3>Linked shops</h3>
        {customer.linkedShops.length === 0 ? (
          <p>No linked shops.</p>
        ) : (
          <ul>
            {customer.linkedShops.map((shop) => (
              <li key={shop.shopId}>{shop.shopName}</li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Customer addresses">
        <h3>Addresses</h3>
        {customer.addresses.length === 0 ? (
          <p>No saved addresses.</p>
        ) : (
          <ul>
            {customer.addresses.map((address) => (
              <li key={address.id}>{address.address}</li>
            ))}
          </ul>
        )}
      </section>

      <SegmentsPage segments={customer.segments} />

      {canMerge ? (
        <button className="admin-secondary-button" type="button" onClick={onMerge}>
          Merge customer
        </button>
      ) : null}
    </article>
  );
}
