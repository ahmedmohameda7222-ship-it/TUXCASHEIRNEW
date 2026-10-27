import type { AdminCustomerDetail, AdminLoyaltyProgram } from '@tux/admin-contracts';
import { useState, type ReactNode } from 'react';

import { AdminTabs } from '../components/navigation/AdminTabs';
import { SegmentsPage } from './SegmentsPage';

function money(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const abs = value < 0n ? -value : value;
  const pounds = new Intl.NumberFormat('en-EG').format(abs / 100n);
  return `EGP ${value < 0n ? '-' : ''}${pounds}.${String(abs % 100n).padStart(2, '0')}`;
}

function customerInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toLocaleUpperCase())
    .join('');
}

function loyaltyLabel(type: string): string {
  const labels: Record<string, string> = {
    EARN: 'Points earned',
    REDEEM: 'Points redeemed',
    MANUAL_ADJUSTMENT: 'Manual adjustment',
    EXPIRY: 'Points expired',
    CANCEL_COMPENSATION: 'Cancellation adjustment',
    REFUND_COMPENSATION: 'Refund adjustment',
    RETURN_COMPENSATION: 'Return adjustment',
  };
  return labels[type] ?? 'Loyalty update';
}

function orderDate(date: string | null): string {
  return date ? new Date(date).toLocaleDateString('en-GB') : 'No orders yet';
}

type CustomerDetailSection = 'overview' | 'orders' | 'addresses' | 'loyalty' | 'history';

export function CustomerDetailPage({
  customer,
  loyalty,
  program = null,
  canMerge,
  canAdjustPoints = false,
  onClose,
  onMerge,
}: {
  customer: AdminCustomerDetail;
  loyalty: ReactNode;
  program?: AdminLoyaltyProgram | null;
  canMerge: boolean;
  canAdjustPoints?: boolean;
  onClose?(): void;
  onMerge(): void;
}) {
  const [section, setSection] = useState<CustomerDetailSection>('overview');

  return (
    <article
      className="admin-customer-detail"
      aria-label={`Customer ${customer.displayName ?? customer.normalizedPhone}`}
    >
      <header className="admin-customer-detail__header">
        <span className="admin-customer-detail__avatar" aria-hidden="true">
          {customerInitials(customer.displayName ?? customer.normalizedPhone)}
        </span>
        <div className="admin-customer-detail__identity">
          <p className="admin-entry__eyebrow">Customer profile</p>
          <h2>{customer.displayName ?? 'Unnamed customer'}</h2>
          <p>{customer.normalizedPhone}</p>
        </div>
        {onClose ? (
          <button
            className="admin-customer-detail__close"
            type="button"
            aria-label="Close customer profile"
            onClick={onClose}
          >
            ×
          </button>
        ) : null}
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
                <dl className="admin-customer-detail__metrics">
                  <div aria-label={`Total orders: ${customer.orderCount} orders`}>
                    <dt>Total orders</dt>
                    <dd>{customer.orderCount}</dd>
                  </div>
                  <div>
                    <dt>Total spent</dt>
                    <dd>{money(customer.lifetimeSpendMinor)}</dd>
                  </div>
                  <div>
                    <dt>Loyalty points</dt>
                    <dd>{customer.loyaltyBalance}</dd>
                  </div>
                </dl>
                <div className="admin-customer-detail__facts">
                  <section>
                    <h3>Contact information</h3>
                    <dl>
                      <div>
                        <dt>Phone</dt>
                        <dd>{customer.normalizedPhone}</dd>
                      </div>
                      <div>
                        <dt>Email</dt>
                        <dd>—</dd>
                      </div>
                      <div>
                        <dt>Notes</dt>
                        <dd>—</dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h3>Loyalty summary</h3>
                    <dl>
                      <div>
                        <dt>Points balance</dt>
                        <dd>{customer.loyaltyBalance} points</dd>
                      </div>
                      <div>
                        <dt>Earn rate</dt>
                        <dd>
                          {program ? `${program.earnPointsPer100Minor} points / EGP 1` : 'Not configured'}
                        </dd>
                      </div>
                      <div>
                        <dt>Point value</dt>
                        <dd>
                          {program ? money(program.redemptionMinorPerPoint) : 'Not configured'}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <SegmentsPage segments={customer.segments} />
                {canMerge || canAdjustPoints ? (
                  <section className="admin-customer-detail__actions" aria-label="Quick actions">
                    <h3>Quick actions</h3>
                    <div>
                      {canAdjustPoints ? (
                        <button
                          className="admin-secondary-button"
                          type="button"
                          onClick={() => setSection('loyalty')}
                        >
                          Adjust points
                        </button>
                      ) : null}
                      {canMerge ? (
                        <button className="admin-secondary-button" type="button" onClick={onMerge}>
                          Merge customer
                        </button>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </>
            ),
          },
          {
            id: 'orders',
            label: 'Orders',
            content: (
              <dl className="admin-customer-detail__metrics">
                <div>
                  <dt>All orders</dt>
                  <dd>{customer.orderCount} orders</dd>
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
                  <dd>{orderDate(customer.lastOrderAt)}</dd>
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
      <section className="admin-customer-detail__activity" aria-label="Recent loyalty activity">
        <h3>Recent loyalty activity</h3>
        {customer.loyaltyHistory.length === 0 ? (
          <p>No loyalty activity yet.</p>
        ) : (
          <ul>
            {customer.loyaltyHistory.slice(0, 5).map((event) => (
              <li key={event.id}>
                <span>{event.reason?.label ?? loyaltyLabel(event.eventType)}</span>
                <strong>
                  {event.pointsDelta > 0 ? '+' : ''}
                  {event.pointsDelta} pts
                </strong>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleDateString('en-GB')}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
