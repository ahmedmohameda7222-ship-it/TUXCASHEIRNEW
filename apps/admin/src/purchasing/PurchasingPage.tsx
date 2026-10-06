import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminTabs } from '../components/navigation/AdminTabs';
import { useShopScope } from '../shops/ShopScopeProvider';
import { PurchaseOrderPage } from './PurchaseOrderPage';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { ReceivePurchasePage } from './ReceivePurchasePage';
import { SuppliersPage } from './SuppliersPage';
import { usePurchasing } from './usePurchasing';

type ActionMode = 'receive' | 'return' | null;
type PurchasingSection = 'orders' | 'suppliers';

function latestMutationError(
  mutations: readonly { error: unknown; submittedAt: number }[],
): unknown {
  let latest: { error: unknown; submittedAt: number } | null = null;
  for (const mutation of mutations) {
    if (mutation.submittedAt <= 0) continue;
    if (latest === null || mutation.submittedAt >= latest.submittedAt) latest = mutation;
  }
  return latest?.error ?? null;
}

function mutationErrorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.trim().replaceAll('_', ' ').replaceAll('-', ' ');
  return normalized || 'Purchasing action failed';
}

export function PurchasingPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const selectedId = detailIdFromPath(location, '/purchasing');
  const purchasing = usePurchasing(shopId);
  const workspace = purchasing.workspace.data;
  const mutationError = latestMutationError([
    purchasing.createSupplier,
    purchasing.createPurchaseOrder,
    purchasing.updatePurchaseOrder,
    purchasing.orderPurchaseOrder,
    purchasing.receivePurchase,
    purchasing.returnPurchase,
  ]);
  const mutationErrorText = mutationErrorMessage(mutationError);
  const [action, setAction] = useState<ActionMode>(null);
  const [section, setSection] = useState<PurchasingSection>('orders');

  const selected = useMemo(
    () => workspace?.purchaseOrders.find((order) => order.id === selectedId) ?? null,
    [selectedId, workspace?.purchaseOrders],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Purchasing"
        title="Purchasing"
        description="Select a shop to manage suppliers and purchase orders."
      />
    );
  }
  if (purchasing.workspace.isLoading) {
    return (
      <PageScaffold
        eyebrow="Purchasing"
        title="Purchasing"
        description="Manage supplier purchasing for this shop."
      >
        <LoadingState title="Loading purchasing" />
      </PageScaffold>
    );
  }
  if (purchasing.workspace.isError || !workspace) {
    return (
      <PageScaffold
        eyebrow="Purchasing"
        title="Purchasing"
        description="Manage supplier purchasing for this shop."
      >
        <ErrorState
          title="Purchasing could not be loaded"
          action={
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => void purchasing.workspace.refetch()}
            >
              Retry
            </button>
          }
        />
      </PageScaffold>
    );
  }

  const canManage = principal.permissions.includes('purchasing.manage');
  const canReceive = principal.permissions.includes('purchasing.receive');

  return (
    <PageScaffold
      eyebrow="Supplier purchasing"
      title="Purchasing"
      description="Create purchase orders, receive deliveries and record supplier returns."
    >
      {mutationErrorText ? (
        <p className="admin-inventory-note" role="alert">
          {mutationErrorText}
        </p>
      ) : null}
      <ResponsiveMasterDetail
        listLabel="Purchasing"
        detailLabel="Purchase order detail"
        detailActive={selectedId !== null}
        backHref="/purchasing"
        list={
          <AdminTabs<PurchasingSection>
            label="Purchasing sections"
            value={section}
            onChange={setSection}
            tabs={[
              {
                id: 'orders',
                label: 'Purchase orders',
                content: (
                  <PurchaseOrdersPage
                    purchaseOrders={workspace.purchaseOrders}
                    suppliers={workspace.suppliers}
                    inventoryItems={workspace.inventoryItems}
                    selectedId={selectedId}
                    canManage={canManage}
                    pending={purchasing.createPurchaseOrder.isPending}
                    onSelect={(id) => {
                      navigate(detailPath('/purchasing', id));
                      setAction(null);
                    }}
                    onCreate={(input) => purchasing.createPurchaseOrder.mutate(input)}
                  />
                ),
              },
              {
                id: 'suppliers',
                label: 'Suppliers',
                content: (
                  <SuppliersPage
                    suppliers={workspace.suppliers}
                    canManage={canManage}
                    pending={purchasing.createSupplier.isPending}
                    onCreate={(input, onSuccess) =>
                      purchasing.createSupplier.mutate(input, { onSuccess })
                    }
                  />
                ),
              },
            ]}
          />
        }
        detail={
          selected ? (
            <>
              <PurchaseOrderPage
                order={selected}
                canManage={canManage}
                canReceive={canReceive}
                ordering={purchasing.orderPurchaseOrder.isPending}
                onOrder={() =>
                  purchasing.orderPurchaseOrder.mutate({
                    purchaseOrderId: selected.id,
                    expectedVersion: selected.version,
                  })
                }
                onReceive={() => setAction('receive')}
                onReturn={() => setAction('return')}
              />
              {action ? (
                <ReceivePurchasePage
                  order={selected}
                  mode={action}
                  pending={
                    action === 'receive'
                      ? purchasing.receivePurchase.isPending
                      : purchasing.returnPurchase.isPending
                  }
                  onCancel={() => setAction(null)}
                  onReceive={(input) =>
                    purchasing.receivePurchase.mutate(
                      { purchaseOrderId: selected.id, ...input },
                      { onSuccess: () => setAction(null) },
                    )
                  }
                  onReturn={(input) =>
                    purchasing.returnPurchase.mutate(
                      { purchaseOrderId: selected.id, ...input },
                      { onSuccess: () => setAction(null) },
                    )
                  }
                />
              ) : null}
            </>
          ) : (
            <ErrorState
              title="Purchase order unavailable"
              description="This purchase order may not exist or may not be available in your current shop scope."
            />
          )
        }
        emptyDetail={
          <EmptyState
            title="Select a purchase order"
            description="Review supplier, quantities, receiving progress and returns."
          />
        }
      />
    </PageScaffold>
  );
}
