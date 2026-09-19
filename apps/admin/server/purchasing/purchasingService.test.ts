import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createPurchasingService, type PurchasingStore } from './purchasingService';

const buyer: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'OWNER',
  permissions: ['purchasing.view', 'purchasing.manage', 'purchasing.receive', 'inventory.view'],
  shopIds: ['shop-a'],
};

function store(overrides: Partial<PurchasingStore> = {}): PurchasingStore {
  return {
    loadWorkspace: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      suppliers: [],
      purchaseOrders: [],
    }),
    createSupplier: vi.fn().mockResolvedValue({
      ok: true,
      supplierId: 'supplier-1',
    }),
    createPurchaseOrder: vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      status: 'DRAFT',
      version: 1,
    }),
    updatePurchaseOrder: vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      status: 'DRAFT',
      version: 2,
    }),
    orderPurchaseOrder: vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      status: 'ORDERED',
      version: 3,
    }),
    receivePurchase: vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      receiptId: 'receipt-1',
      status: 'PARTIALLY_RECEIVED',
      version: 4,
      idempotentReplay: false,
    }),
    returnPurchase: vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      returnId: 'return-1',
      status: 'PARTIALLY_RECEIVED',
      version: 5,
      idempotentReplay: false,
    }),
    ...overrides,
  };
}

describe('Admin purchasing service', () => {
  it('marks a partially received PO without pretending the remainder arrived', async () => {
    const purchasingStore = store();
    const service = createPurchasingService(purchasingStore);

    await expect(
      service.receivePurchase(
        {
          shopId: 'shop-a',
          purchaseOrderId: 'po-1',
          commandId: 'receive-1',
          supplierReference: 'INV-1001',
          lines: [
            {
              lineId: 'line-1',
              receivedBaseMicros: 9_500,
              unitCostMinor: 125,
            },
          ],
        },
        buyer,
      ),
    ).resolves.toMatchObject({
      ok: true,
      purchaseOrderId: 'po-1',
      status: 'PARTIALLY_RECEIVED',
    });

    expect(purchasingStore.receivePurchase).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-a',
      purchaseOrderId: 'po-1',
      commandId: 'receive-1',
      supplierReference: 'INV-1001',
      lines: [
        {
          lineId: 'line-1',
          receivedBaseMicros: 9_500,
          unitCostMinor: 125,
        },
      ],
    });
  });

  it('requires purchasing.receive and explicit shop scope before receiving', async () => {
    const receivePurchase = vi.fn();
    const service = createPurchasingService(store({ receivePurchase }));
    const managerWithoutReceive: AdminSessionPrincipal = {
      ...buyer,
      permissions: ['purchasing.view', 'purchasing.manage'],
    };

    await expect(
      service.receivePurchase(
        {
          shopId: 'shop-a',
          purchaseOrderId: 'po-1',
          commandId: 'receive-1',
          supplierReference: null,
          lines: [{ lineId: 'line-1', receivedBaseMicros: 1_000, unitCostMinor: 100 }],
        },
        managerWithoutReceive,
      ),
    ).rejects.toThrow(/permission_forbidden/);

    await expect(
      service.receivePurchase(
        {
          shopId: 'shop-b',
          purchaseOrderId: 'po-1',
          commandId: 'receive-2',
          supplierReference: null,
          lines: [{ lineId: 'line-1', receivedBaseMicros: 1_000, unitCostMinor: 100 }],
        },
        buyer,
      ),
    ).rejects.toThrow(/shop_forbidden/);

    expect(receivePurchase).not.toHaveBeenCalled();
  });

  it('keeps purchase returns behind the trusted purchasing.receive boundary', async () => {
    const returnPurchase = vi.fn().mockResolvedValue({
      ok: true,
      purchaseOrderId: 'po-1',
      returnId: 'return-1',
      status: 'RECEIVED',
      version: 6,
      idempotentReplay: false,
    });
    const service = createPurchasingService(store({ returnPurchase }));

    await expect(
      service.returnPurchase(
        {
          shopId: 'shop-a',
          purchaseOrderId: 'po-1',
          commandId: 'return-1',
          supplierReference: 'CN-1',
          lines: [{ lineId: 'line-1', returnedBaseMicros: 500, unitCostMinor: 125 }],
        },
        buyer,
      ),
    ).resolves.toMatchObject({ ok: true, returnId: 'return-1' });

    expect(returnPurchase).toHaveBeenCalledWith({
      employeeId: 'employee-1',
      shopId: 'shop-a',
      purchaseOrderId: 'po-1',
      commandId: 'return-1',
      supplierReference: 'CN-1',
      lines: [{ lineId: 'line-1', returnedBaseMicros: 500, unitCostMinor: 125 }],
    });
  });

  it('loads purchasing only with purchasing.view and the principal business/shop boundary', async () => {
    const purchasingStore = store();
    const service = createPurchasingService(purchasingStore);

    await expect(service.loadWorkspace('shop-a', buyer)).resolves.toMatchObject({
      shopId: 'shop-a',
    });
    expect(purchasingStore.loadWorkspace).toHaveBeenCalledWith('shop-a', 'business-1');

    await expect(service.loadWorkspace('shop-b', buyer)).rejects.toThrow(/shop_forbidden/);
  });
});
