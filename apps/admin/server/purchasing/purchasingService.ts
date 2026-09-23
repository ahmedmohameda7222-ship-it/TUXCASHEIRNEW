import type {
  AdminPurchasingWorkspace,
  AdminSessionPrincipal,
  CreatePurchaseOrderInput,
  CreateSupplierInput,
  PurchasingCommandResult,
  ReceivePurchaseInput,
  ReturnPurchaseInput,
  UpdatePurchaseOrderInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';

export interface PurchasingStore {
  loadWorkspace(shopId: string, businessId: string): Promise<AdminPurchasingWorkspace>;
  createSupplier(
    input: CreateSupplierInput & { employeeId: string; businessId: string },
  ): Promise<PurchasingCommandResult>;
  createPurchaseOrder(
    input: CreatePurchaseOrderInput & { employeeId: string; businessId: string },
  ): Promise<PurchasingCommandResult>;
  updatePurchaseOrder(
    input: UpdatePurchaseOrderInput & { employeeId: string },
  ): Promise<PurchasingCommandResult>;
  orderPurchaseOrder(input: {
    employeeId: string;
    shopId: string;
    purchaseOrderId: string;
    expectedVersion: number;
    commandId: string;
  }): Promise<PurchasingCommandResult>;
  receivePurchase(
    input: ReceivePurchaseInput & { employeeId: string },
  ): Promise<PurchasingCommandResult>;
  returnPurchase(
    input: ReturnPurchaseInput & { employeeId: string },
  ): Promise<PurchasingCommandResult>;
}

export function createPurchasingService(store: PurchasingStore) {
  return {
    async loadWorkspace(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<AdminPurchasingWorkspace> {
      requirePermission(principal, 'purchasing.view', shopId);
      return store.loadWorkspace(shopId, principal.businessId);
    },

    async createSupplier(
      input: CreateSupplierInput,
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.manage', input.shopId);
      return store.createSupplier({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    async createPurchaseOrder(
      input: CreatePurchaseOrderInput,
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.manage', input.shopId);
      return store.createPurchaseOrder({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    async updatePurchaseOrder(
      input: UpdatePurchaseOrderInput,
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.manage', input.shopId);
      return store.updatePurchaseOrder({ ...input, employeeId: principal.employeeId });
    },

    async orderPurchaseOrder(
      input: {
        shopId: string;
        purchaseOrderId: string;
        expectedVersion: number;
        commandId: string;
      },
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.manage', input.shopId);
      return store.orderPurchaseOrder({ ...input, employeeId: principal.employeeId });
    },

    async receivePurchase(
      input: ReceivePurchaseInput,
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.receive', input.shopId);
      return store.receivePurchase({ ...input, employeeId: principal.employeeId });
    },

    async returnPurchase(
      input: ReturnPurchaseInput,
      principal: AdminSessionPrincipal,
    ): Promise<PurchasingCommandResult> {
      requirePermission(principal, 'purchasing.receive', input.shopId);
      return store.returnPurchase({ ...input, employeeId: principal.employeeId });
    },
  };
}
