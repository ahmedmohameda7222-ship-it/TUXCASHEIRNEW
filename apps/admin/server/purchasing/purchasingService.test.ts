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
    loadHistory: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      purchaseOrderId: 'po-1',
      truncated: false,
      events: [],
    }),
    loadWorkspace: vi.fn().mockResolvedValue({
      shopId: 'shop-a',
      suppliers: [],
      purchaseOrders: [],
    }),
    manageSupplier: vi.fn().mockResolvedValue({ ok: true, supplierId: 'supplier-1', version: 2 }),
    replaceDraftPurchaseOrderLines: vi
      .fn()
      .mockResolvedValue({ ok: true, purchaseOrderId: 'po-1', status: 'DRAFT', version: 2 }),
    cancelPurchaseOrder: vi
      .fn()
      .mockResolvedValue({ ok: true, purchaseOrderId: 'po-1', status: 'CANCELLED', version: 2 }),
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
  it('requires purchasing.view and the same authorized business/shop for PO chronology', async () => {
    const purchasingStore = store();
    const service = createPurchasingService(purchasingStore);
    await expect(service.loadHistory('shop-a', 'po-1', buyer)).resolves.toMatchObject({
      shopId: 'shop-a',
      purchaseOrderId: 'po-1',
      events: [],
    });
    expect(purchasingStore.loadHistory).toHaveBeenCalledWith('shop-a', 'business-1', 'po-1');
    await expect(service.loadHistory('shop-b', 'po-1', buyer)).rejects.toThrow(/shop_forbidden/);
    await expect(
      service.loadHistory('shop-a', 'po-1', {
        ...buyer,
        permissions: ['purchasing.manage', 'purchasing.receive'],
      }),
    ).rejects.toThrow(/permission_forbidden/);
    expect(purchasingStore.loadHistory).toHaveBeenCalledTimes(1);
  });

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
              receivedPurchaseUnitsMicros: 9_500,
              purchaseUnitCostMinor: 125,
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
          receivedPurchaseUnitsMicros: 9_500,
          purchaseUnitCostMinor: 125,
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
          lines: [
            { lineId: 'line-1', receivedPurchaseUnitsMicros: 1_000, purchaseUnitCostMinor: 100 },
          ],
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
          lines: [
            { lineId: 'line-1', receivedPurchaseUnitsMicros: 1_000, purchaseUnitCostMinor: 100 },
          ],
        },
        buyer,
      ),
    ).rejects.toThrow(/shop_forbidden/);

    expect(receivePurchase).not.toHaveBeenCalled();
  });

  it('P4 restricts supplier lifecycle commands by role, shop, and version', async () => {
    const manageSupplier = vi.fn().mockResolvedValue({
      ok: true,
      supplierId: 'supplier-1',
      version: 5,
    });
    const service = createPurchasingService(store({ manageSupplier }));
    const input = {
      type: 'supplier.archive' as const,
      shopId: 'shop-a',
      supplierId: 'supplier-1',
      expectedVersion: 4,
      payload: {},
      commandId: 'supplier-archive-1',
    };

    const manager: AdminSessionPrincipal = { ...buyer, role: 'MANAGER' };
    const viewer: AdminSessionPrincipal = { ...buyer, permissions: ['purchasing.view'] };
    const otherShop = { ...input, shopId: 'shop-b' };
    await expect(service.manageSupplier(input, manager)).rejects.toThrow(/permission_forbidden/);
    await expect(service.manageSupplier(input, viewer)).rejects.toThrow(/permission_forbidden/);
    await expect(service.manageSupplier(otherShop, buyer)).rejects.toThrow(/shop_forbidden/);
    expect(manageSupplier).not.toHaveBeenCalled();

    await expect(service.manageSupplier(input, buyer)).resolves.toMatchObject({
      ok: true,
      version: 5,
    });
    expect(manageSupplier).toHaveBeenCalledWith({
      ...input,
      employeeId: 'employee-1',
    });

    const restore = {
      ...input,
      type: 'supplier.restore' as const,
      expectedVersion: 5,
      commandId: 'supplier-restore-1',
    };
    await service.manageSupplier(restore, { ...buyer, role: 'ADMIN' });
    expect(manageSupplier).toHaveBeenLastCalledWith({
      ...restore,
      employeeId: 'employee-1',
    });
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
          lines: [{ lineId: 'line-1', returnedPurchaseUnitsMicros: 500 }],
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
      lines: [{ lineId: 'line-1', returnedPurchaseUnitsMicros: 500 }],
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
