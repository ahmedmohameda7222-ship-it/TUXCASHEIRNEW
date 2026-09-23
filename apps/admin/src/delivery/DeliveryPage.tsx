import type {
  AdminDeliveryConfigMutationResult,
  AdminDeliveryMutationResult,
  AdminDeliveryWorkspace,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
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

export function DeliveryPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
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
        description="Select a concrete shop to manage delivery zones, riders and dispatch state."
      />
    );
  }

  const workspace = workspaceQuery.data;
  const canManage = principal.permissions.includes('delivery.manage');
  const editingZone =
    typeof editingZoneId === 'string'
      ? (workspace?.zones.find((zone) => zone.id === editingZoneId) ?? null)
      : null;

  return (
    <PageScaffold
      eyebrow="Delivery authority"
      title="Delivery"
      description="Server-authoritative zones, routing constraints, riders and append-only dispatch state."
    >
      {workspaceQuery.isLoading ? <p>Loading delivery workspace…</p> : null}
      {workspaceQuery.isError ? <p role="alert">Delivery workspace could not be loaded.</p> : null}

      {workspace ? (
        <>
          <section aria-label="Delivery zones">
            <header className="admin-section-header">
              <div>
                <h2>Delivery zones</h2>
                <p>Canonical fee, minimum, boundary, priority and explicit fallback configuration.</p>
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
              <p>No delivery zones configured.</p>
            ) : (
              <div className="admin-inventory-list">
                {workspace.zones.map((zone) => (
                  <button
                    className="admin-inventory-row"
                    type="button"
                    key={zone.id}
                    disabled={!canManage}
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
                ))}
              </div>
            )}

            {editingZoneId !== undefined && canManage ? (
              <ZoneEditor
                zone={editingZone}
                saving={saveZone.isPending}
                onSave={(input) => saveZone.mutate(input)}
                onCancel={() => setEditingZoneId(undefined)}
              />
            ) : null}
          </section>

          <RidersPage
            riders={workspace.riders}
            saving={saveRider.isPending}
            onSave={(input) => saveRider.mutate(input)}
          />

          <section aria-label="Delivery orders">
            <h2>Delivery orders</h2>
            {workspace.orders.length === 0 ? (
              <p>No delivery orders require dispatch management.</p>
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
                  <article key={order.orderId} aria-label={`Delivery order ${order.orderId}`}>
                    <strong>{order.orderId}</strong>
                    <span>{order.state}</span>
                  </article>
                ),
              )
            )}
          </section>
        </>
      ) : null}

      {saveZone.isError || saveRider.isError || transitionOrder.isError ? (
        <p role="alert">Delivery action failed. Refresh the workspace and try again.</p>
      ) : null}
    </PageScaffold>
  );
}
