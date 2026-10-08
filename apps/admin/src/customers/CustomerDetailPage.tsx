import type { AdminCustomerDetail } from '@tux/admin-contracts';
import { useState, type ReactNode } from 'react';

import { AdminTabs } from '../components/navigation/AdminTabs';
import { SegmentsPage } from './SegmentsPage';

function money(minor: number): string {
  return `${(minor / 100).toFixed(2)} EGP`;
}

type CustomerDetailSection = 'overview' | 'orders' | 'addresses' | 'loyalty' | 'history';

export function CustomerDetailPage({
  customer,
  loyalty,
  canMerge,
  onMerge,
}: {
  customer: AdminCustomerDetail;
  loyalty: ReactNode;
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
            id: 'orders',
            label: 'Orders',
            content: (
              <dl>
                <div>
                  <dt>All orders</dt>
                  <dd>{customer.orderCount}</dd>
                </div>
                <div>
                  <dt>Delivery orders</dt>
                  <dd>{customer.deliveryOrderCount}</dd>
                </div>
                <div>
                  <dt>Lifetime spend</dt>
                  <dd>{money(customer.lifetimeSpendMinor)}</dd>
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
            id: 'loyalty',
            label: 'Loyalty',
            content: loyalty,
          },
          {
            id: 'history',
            label: 'History',
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
