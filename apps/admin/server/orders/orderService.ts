import type {
  AdminOrderCancellationResult,
  AdminOrderDetail,
  AdminOrderFinancialMutationResult,
  AdminOrderSearchInput,
  AdminOrderSearchResult,
  AdminSessionPrincipal,
  CancelAdminOrderInput,
  RequestAdminRefundInput,
  ReturnAdminOrderItemsInput,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';

type OrderActor = { employeeId: string; businessId: string };

export interface OrderStore {
  searchOrders(input: AdminOrderSearchInput & OrderActor): Promise<AdminOrderSearchResult>;
  getOrderDetail(input: {
    shopId: string;
    orderId: string;
    employeeId: string;
    businessId: string;
  }): Promise<AdminOrderDetail | null>;
  cancelActiveOrder(
    input: CancelAdminOrderInput & OrderActor,
  ): Promise<AdminOrderCancellationResult>;
  requestRefund(
    input: RequestAdminRefundInput & OrderActor,
  ): Promise<AdminOrderFinancialMutationResult>;
  returnOrderItems(
    input: ReturnAdminOrderItemsInput & OrderActor,
  ): Promise<AdminOrderFinancialMutationResult>;
}

export function createOrderService(store: OrderStore) {
  return {
    searchOrders(
      input: AdminOrderSearchInput,
      principal: AdminSessionPrincipal,
    ): Promise<AdminOrderSearchResult> {
      requirePermission(principal, 'orders.view', input.shopId);
      return store.searchOrders({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    getOrderDetail(
      input: { shopId: string; orderId: string },
      principal: AdminSessionPrincipal,
    ): Promise<AdminOrderDetail | null> {
      requirePermission(principal, 'orders.view', input.shopId);
      return store.getOrderDetail({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    cancelActiveOrder(
      input: CancelAdminOrderInput,
      principal: AdminSessionPrincipal,
    ): Promise<AdminOrderCancellationResult> {
      requirePermission(principal, 'orders.cancel', input.shopId);
      return store.cancelActiveOrder({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    requestRefund(
      input: RequestAdminRefundInput,
      principal: AdminSessionPrincipal,
    ): Promise<AdminOrderFinancialMutationResult> {
      requirePermission(principal, 'orders.refund', input.shopId);
      return store.requestRefund({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },

    returnOrderItems(
      input: ReturnAdminOrderItemsInput,
      principal: AdminSessionPrincipal,
    ): Promise<AdminOrderFinancialMutationResult> {
      requirePermission(principal, 'orders.refund', input.shopId);
      return store.returnOrderItems({
        ...input,
        employeeId: principal.employeeId,
        businessId: principal.businessId,
      });
    },
  };
}
