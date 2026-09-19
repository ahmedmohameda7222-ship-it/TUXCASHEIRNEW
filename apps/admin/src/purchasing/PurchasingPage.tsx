import { useEffect, useMemo, useState } from 'react';

import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { PurchaseOrderPage } from './PurchaseOrderPage';
import { PurchaseOrdersPage } from './PurchaseOrdersPage';
import { ReceivePurchasePage } from './ReceivePurchasePage';
import { SuppliersPage } from './SuppliersPage';
import { usePurchasing } from './usePurchasing';

type ActionMode = 'receive' | 'return' | null;

export function PurchasingPage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const purchasing = usePurchasing(shopId);
  const workspace = purchasing.workspace.data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<ActionMode>(null);

  useEffect(() => {
    const orders = workspace?.purchaseOrders ?? [];
    if (selectedId && orders.some((order) => order.id === selectedId)) return;
    setSelectedId(orders[0]?.id ?? null);
    setAction(null);
  }, [selectedId, workspace?.purchaseOrders]);

  const selected = useMemo(
    () => workspace?.purchaseOrders.find((order) => order.id === selectedId) ?? null,
    [selectedId, workspace?.purchaseOrders],
  );

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Purchasing"
        title="Purchasing"
        description="Select a concrete shop to manage suppliers and purchase orders."
      />
    );
  }

  if (purchasing.workspace.isLoading) {
    return (
      <PageScaffold eyebrow="Purchasing" title="Purchasing" description="Loading purchasing…" />
    );
  }

  if (purchasing.workspace.isError || !workspace) {
    return (
      <PageScaffold
        eyebrow="Purchasing"
        title="Purchasing"
        description="Purchasing could not be loaded. Retry after the Admin backend is available."
      />
    );
  }

  const canManage = principal.permissions.includes('purchasing.manage');
  const canReceive = principal.permissions.includes('purchasing.receive');

  return (
    <PageScaffold
      eyebrow="Supplier purchasing"
      title="Purchasing"
      description="Draft, order, receive and return supplier purchases through trusted server-side inventory transactions."
    >
      <div className="admin-inventory-layout">
        <div className="admin-inventory-list">
          <SuppliersPage
            suppliers={workspace.suppliers}
            pending={purchasing.createSupplier.isPending}
            onCreate={(input) => purchasing.createSupplier.mutate(input)}
          />
          <PurchaseOrdersPage
            purchaseOrders={workspace.purchaseOrders}
            suppliers={workspace.suppliers}
            inventoryItems={workspace.inventoryItems}
            selectedId={selectedId}
            pending={purchasing.createPurchaseOrder.isPending}
            onSelect={(id) => {
              setSelectedId(id);
              setAction(null);
            }}
            onCreate={(input) => purchasing.createPurchaseOrder.mutate(input)}
          />
        </div>
        <div className="admin-inventory-inspector">
          {selected ? (
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
            <div className="admin-empty-state">
              <strong>Select a purchase order</strong>
              <span>Review supplier, quantities, receiving progress and returns.</span>
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
