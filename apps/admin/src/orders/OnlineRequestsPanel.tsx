import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminOnlineOrderRequestsResult, AdminOnlineOrderRequest } from '@tux/admin-contracts';
import { useState } from 'react';
import { Link } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { adminFetch } from '../lib/adminApi';

type OnlineStatus = AdminOnlineOrderRequest['status'] | '';

function cairoTime(value: string): string {
  return new Intl.DateTimeFormat('en-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Africa/Cairo',
  }).format(new Date(value));
}

export function OnlineRequestsPanel({
  shopId,
  initialStatus = '',
  date = '',
}: {
  shopId: string;
  initialStatus?: OnlineStatus;
  date?: string;
}) {
  const [status, setStatus] = useState<OnlineStatus>(initialStatus);
  const requests = useInfiniteQuery({
    queryKey: ['admin', 'orders', shopId, 'online-requests', status, date],
    initialPageParam: null as string | null,
    refetchInterval: 20_000,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ shopId, view: 'online-requests', limit: '50' });
      if (status) params.set('status', status);
      if (date) params.set('date', date);
      if (pageParam) params.set('cursor', pageParam);
      return adminFetch<AdminOnlineOrderRequestsResult>(`/api/admin/orders?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const pages = requests.data?.pages ?? [];
  const mismatchedShop = pages.some((page) => page.shopId !== shopId);
  const rows = mismatchedShop
    ? []
    : pages.flatMap((page) => page.rows).filter((request) => request.shopId === shopId);

  return (
    <section className="admin-order-detail__card" aria-label="Online request history">
      <h2>Online requests</h2>
      <p>
        Read-only history. Operations remains responsible for claiming, accepting and rejecting
        requests. A rejected request has no canonical order.
      </p>
      {date ? (
        <p>
          Calendar day (Africa/Cairo): {date}
          {status !== 'REJECTED' ? ' · request submission date' : ' · rejection date'}
        </p>
      ) : null}
      <label className="admin-field">
        <span>Request status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as OnlineStatus)}>
          <option value="">All requests</option>
          <option value="PENDING">Incoming / Pending</option>
          <option value="PROCESSING">Claimed in Operations</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      {requests.isLoading ? <LoadingState title="Loading online requests" /> : null}
      {requests.isError ? (
        <ErrorState
          title="Online requests could not be loaded"
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void requests.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {mismatchedShop ? <p role="alert">Request shop mismatch. Results withheld.</p> : null}
      {!requests.isLoading && !requests.isError && pages.length > 0 && rows.length === 0 ? (
        <EmptyState
          title="No matching online requests"
          description="No online request history matches the selected shop, status and date."
        />
      ) : null}
      {!mismatchedShop ? (
        <ol className="admin-order-detail__list">
          {rows.map((request) => (
            <li className="admin-order-detail__card" key={request.id}>
              <strong>
                {request.customerName} · {request.status}
              </strong>
              <p>
                Request: <code>{request.id}</code>
              </p>
              {request.normalizedPhone ? <p>Phone: {request.normalizedPhone}</p> : null}
              <p>
                {request.fulfillmentPreference} · requested payment: {request.paymentPreference}
              </p>
              <p>Submitted: {cairoTime(request.createdAt)}</p>
              {request.resolvedAt ? <p>Resolved: {cairoTime(request.resolvedAt)}</p> : null}
              {request.rejectionReason ? <p>Rejection reason: {request.rejectionReason}</p> : null}
              <details>
                <summary>Submitted items</summary>
                <pre>{JSON.stringify(request.trustedItems, null, 2)}</pre>
              </details>
              <p>Requested item subtotal: {(request.itemsSubtotalMinor / 100).toFixed(2)} EGP</p>
              {request.acceptedOrderId ? (
                <Link href={`/orders/${request.acceptedOrderId}`}>Open canonical order</Link>
              ) : null}
              {request.sourceFingerprint ? (
                <p>
                  Source fingerprint: <code>{request.sourceFingerprint}</code>
                </p>
              ) : null}
              <p>
                Catalog revision: <code>{request.catalogRevision}</code>
              </p>
            </li>
          ))}
        </ol>
      ) : null}
      {!mismatchedShop && requests.hasNextPage ? (
        <button
          className="admin-secondary-button"
          type="button"
          disabled={requests.isFetchingNextPage}
          onClick={() => void requests.fetchNextPage()}
        >
          {requests.isFetchingNextPage ? 'Loading older requests…' : 'Load older requests'}
        </button>
      ) : null}
    </section>
  );
}
