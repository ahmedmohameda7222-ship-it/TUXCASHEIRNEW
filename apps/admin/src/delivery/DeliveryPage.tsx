import type {
  AdminDeliveryConfigMutationResult,
  AdminDeliveryMutationResult,
  AdminDeliveryWorkspace,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { useAdminSession } from '../auth/useAdminSession';
import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
} from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';
import { useShopScope } from '../shops/ShopScopeProvider';
import { DeliveryOrderPanel } from './DeliveryOrderPanel';
import { RidersPage, type DeliveryRiderDraft } from './RidersPage';
import { ZoneEditor, type DeliveryZoneDraft } from './ZoneEditor';

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') {
    throw new Error('session_required');
  }
  return session.state.session.csrfToken;
}

function formatMinor(value: number): string {
  return `${(value / 100).toFixed(2)} EGP`;
}

type DeliverySection = 'active' | 'zones' | 'riders';

function deliveryStateLabel(state: string): string {
  return (
    (
      {
        UNASSIGNED: 'Waiting for rider',
        ASSIGNED: 'Rider assigned',
        OUT_FOR_DELIVERY: 'Out for delivery',
        DELIVERED: 'Delivered',
        FAILED: 'Delivery failed',
        RETURNED: 'Returned',
      } as Record<string, string>
    )[state] ?? 'Delivery in progress'
  );
}

export function DeliveryPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const section: DeliverySection =
    location === '/delivery/zones'
      ? 'zones'
      : location === '/delivery/riders'
        ? 'riders'
        : 'active';
  const [editingZoneId, setEditingZoneId] = useState<string | null | undefined>(undefined);
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);

  const workspaceQuery = useQuery({
    queryKey: ['admin', 'delivery', shopId],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<AdminDeliveryWorkspace>(
        `/api/admin/delivery?shopId=${encodeURIComponent(shopId!)}`,
      ),
  });

  async function refreshWorkspace(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'delivery', shopId] });
  }

  const saveZone = useMutation({
    mutationFn: async (input: DeliveryZoneDraft) => {
      if (!shopId) throw new Error('concrete_shop_required');
      return adminFetch<AdminDeliveryConfigMutationResult>(
        '/api/admin/delivery',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'delivery.zone.upsert',
            shopId,
            ...input,
          }),
        },
        csrfToken(session),
      );
    },
    onSuccess: async () => {
      setEditingZoneId(undefined);
      await refreshWorkspace();
    },
  });

  const saveRider = useMutation({
    mutationFn: async (input: DeliveryRiderDraft) => {
      if (!shopId) throw new Error('concrete_shop_required');
      return adminFetch<AdminDeliveryConfigMutationResult>(
        '/api/admin/delivery',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'delivery.rider.upsert',
            shopId,
            ...input,
          }),
        },
        csrfToken(session),
      );
    },
    onSuccess: refreshWorkspace,
  });

  const transitionOrder = useMutation({
    mutationFn: async (input: {
      orderId: string;
      riderId: string | null;
      expectedVersion: number;
      toState: 'UNASSIGNED' | 'ASSIGNED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
      note: string | null;
    }) => {
      if (!shopId) throw new Error('concrete_shop_required');
      const intent = { shopId, ...input };
      const commandId = commandIds.forIntent('delivery.transition', intent);
      try {
        const result = await adminFetch<AdminDeliveryMutationResult>(
          '/api/admin/delivery',
          {
            method: 'POST',
            body: JSON.stringify({
              type: 'delivery.transition',
              ...intent,
              commandId,
            }),
          },
          csrfToken(session),
        );
        commandIds.complete('delivery.transition', intent);
        return result;
      } catch (error) {
        if (error instanceof AdminApiError) {
          commandIds.complete('delivery.transition', intent);
        }
        throw error;
      }
    },
    onSuccess: refreshWorkspace,
  });

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Delivery"
        title="Delivery"
        description="Select a shop to manage its delivery zones, riders, and active deliveries."
      />
    );
  }

  const workspace = workspaceQuery.data;
  const canManage = principal.permissions.includes('delivery.manage');
  const editingZone =
    typeof editingZoneId === 'string'
      ? (workspace?.zones.find((zone) => zone.id === editingZoneId) ?? null)
      : null;
  const fallbackShops = (workspace?.shops ?? [])
    .filter((option) => option.id !== shopId)
    .map((option) => ({ id: option.id, label: option.name }));

  return (
    <PageScaffold
      eyebrow="Delivery"
      title="Delivery"
      description="Manage delivery zones, riders, routing, and delivery status for the selected shop."
    >
      {workspaceQuery.isLoading ? (
        <LoadingState
          title="Loading delivery"
          description="Getting the latest zones, riders, and delivery status."
        />
      ) : null}
      {workspaceQuery.isError ? (
        <ErrorState
          title="Delivery unavailable"
          description="The delivery workspace could not be loaded."
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void workspaceQuery.refetch()}
            >
              Try again
            </button>
          }
        />
      ) : null}

      <nav className="admin-tabs__list" aria-label="Delivery workspace">
        {[
          { id: 'active' as const, label: 'Active deliveries', href: '/delivery' },
          { id: 'zones' as const, label: 'Zones', href: '/delivery/zones' },
          { id: 'riders' as const, label: 'Riders', href: '/delivery/riders' },
        ].map((item) => (
          <button
            className="admin-tabs__tab"
            aria-current={section === item.id ? 'page' : undefined}
            type="button"
            key={item.id}
            onClick={() => navigate(item.href)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {workspace ? (
        <>
          {section === 'zones' ? (
            <section aria-label="Delivery zones">
              <header className="admin-section-header">
                <div>
                  <h2>Delivery zones</h2>
                  <p>
                    Configure fees, minimum orders, coverage, routing priority, and fallback
                    behavior.
                  </p>
                </div>
                {canManage ? (
                  <button
                    className="admin-primary-button"
                    type="button"
                    onClick={() => setEditingZoneId(null)}
                  >
                    New delivery zone
                  </button>
                ) : null}
              </header>

              {workspace.zones.length === 0 ? (
                <EmptyState
                  title="No delivery zones yet"
                  description={
                    canManage
                      ? 'Create a delivery zone to define coverage and fees.'
                      : 'No delivery zones are configured for this shop.'
                  }
                />
              ) : (
                <div className="admin-inventory-list">
                  {workspace.zones.map((zone) =>
                    canManage ? (
                      <button
                        className="admin-inventory-row"
                        type="button"
                        key={zone.id}
                        onClick={() => setEditingZoneId(zone.id)}
                      >
                        <span>
                          <strong>{zone.name}</strong>
                          <small>
                            Priority {zone.priority} · {zone.active ? 'Active' : 'Inactive'}
                          </small>
                        </span>
                        <span>
                          <strong>{formatMinor(zone.feeMinor)}</strong>
                          <small>{formatMinor(zone.minimumOrderMinor)} minimum</small>
                        </span>
                      </button>
                    ) : (
                      <article className="admin-inventory-row" key={zone.id}>
                        <span>
                          <strong>{zone.name}</strong>
                          <small>
                            Priority {zone.priority} · {zone.active ? 'Active' : 'Inactive'}
                          </small>
                        </span>
                        <span>
                          <strong>{formatMinor(zone.feeMinor)}</strong>
                          <small>{formatMinor(zone.minimumOrderMinor)} minimum</small>
                        </span>
                      </article>
                    ),
                  )}
                </div>
              )}

              {editingZoneId !== undefined && canManage ? (
                <ZoneEditor
                  zone={editingZone}
                  fallbackShops={fallbackShops}
                  saving={saveZone.isPending}
                  onSave={(input) => saveZone.mutate(input)}
                  onCancel={() => setEditingZoneId(undefined)}
                />
              ) : null}
            </section>
          ) : null}

          {section === 'riders' ? (
            <RidersPage
              riders={workspace.riders}
              saving={saveRider.isPending}
              canManage={canManage}
              onSave={(input) => saveRider.mutate(input)}
            />
          ) : null}

          {section === 'active' ? (
            <section aria-label="Active deliveries">
              <h2>Active deliveries</h2>
              {workspace.orders.length === 0 ? (
                <EmptyState
                  title="No active delivery orders"
                  description="Delivery orders that need dispatch attention will appear here."
                />
              ) : (
                workspace.orders.map((order) =>
                  canManage ? (
                    <DeliveryOrderPanel
                      key={order.orderId}
                      order={order}
                      riders={workspace.riders}
                      saving={transitionOrder.isPending}
                      onTransition={(input) => transitionOrder.mutate(input)}
                    />
                  ) : (
                    <article key={order.orderId} aria-label="Delivery order">
                      <strong>
                        {order.displayOrderLabel ??
                          (order.displayOrderNo ? `#${order.displayOrderNo}` : 'Delivery order')}
                      </strong>
                      <span>{deliveryStateLabel(order.state)}</span>
                    </article>
                  ),
                )
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {saveZone.isError || saveRider.isError || transitionOrder.isError ? (
        <InlineError>Delivery action failed. Refresh the workspace and try again.</InlineError>
      ) : null}
    </PageScaffold>
  );
}
