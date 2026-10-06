import type { AdminCustomerDetail } from '@tux/admin-contracts';
import { useState } from 'react';

import { AdminTabs } from '../components/navigation/AdminTabs';
import { SegmentsPage } from './SegmentsPage';

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} EGP`;
}

type CustomerDetailSection = 'overview' | 'addresses' | 'history';

export function CustomerDetailPage({
  customer,
  canMerge,
  onMerge,
}: {
  customer: AdminCustomerDetail;
  canMerge: boolean;
  onMerge(): void;
}) {
  const [section, setSection] = useState<CustomerDetailSection>('overview');

  return (
    <article aria-label={`Customer ${customer.displayName ?? customer.normalizedPhone}`}>
      <header>
        <p className="admin-entry__eyebrow">Customer profile</p>
        <h2>{customer.displayName ?? 'Unnamed customer'}</h2>
        <p>{customer.normalizedPhone}</p>
      </header>

      <AdminTabs<CustomerDetailSection>
        label="Customer detail sections"
        value={section}
        onChange={setSection}
        tabs={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <>
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
                  <div>
                    <dt>Last order</dt>
                    <dd>
                      {customer.lastOrderAt
                        ? new Date(customer.lastOrderAt).toLocaleDateString()
                        : 'No orders yet'}
                    </dd>
                  </div>
                </dl>
                <SegmentsPage segments={customer.segments} />
              </>
            ),
          },
          {
            id: 'addresses',
            label: 'Addresses',
            content:
              customer.addresses.length === 0 ? (
                <p>No saved addresses.</p>
              ) : (
                <ul>
                  {customer.addresses.map((address) => (
                    <li key={address.id}>{address.address}</li>
                  ))}
                </ul>
              ),
          },
          {
            id: 'history',
            label: 'Linked shops',
            content:
              customer.linkedShops.length === 0 ? (
                <p>No linked shops.</p>
              ) : (
                <ul>
                  {customer.linkedShops.map((shop) => (
                    <li key={shop.shopId}>{shop.shopName}</li>
                  ))}
                </ul>
              ),
          },
        ]}
      />

      {canMerge ? (
        <button className="admin-secondary-button" type="button" onClick={onMerge}>
          Merge customer
        </button>
      ) : null}
    </article>
  );
}
