import type {
  AdminOrderFinancialMutationResult,
  AdminApprovalExecutionClaim,
} from '@tux/admin-contracts';

import {
  ApprovalTerminalCommandError,
  type ApprovalExecutionRegistryEntry,
} from '../approvals/approvalExecutionService.js';

export const ORDER_REFUND_APPROVAL_ACTION = 'ORDER_REFUND';
export const ORDER_RETURN_APPROVAL_ACTION = 'ORDER_RETURN';

type OrderApprovalExecutionBase = {
  approvalRequestId: string;
  businessId: string;
  shopId: string;
  requesterEmployeeId: string;
  approverEmployeeId: string;
  orderId: string;
  reasonCodeId: string;
  note: string | null;
  orderCommandId: string;
};

export type ApprovedRefundExecutionInput = OrderApprovalExecutionBase & {
  paymentId: string;
  amountMinor: number;
};

export type ApprovedReturnExecutionInput = OrderApprovalExecutionBase & {
  items: readonly { orderItemId: string; quantity: number }[];
};

export type OrderApprovalExecutionDependencies = {
  executeRefund(input: ApprovedRefundExecutionInput): Promise<AdminOrderFinancialMutationResult>;
  executeReturn(input: ApprovedReturnExecutionInput): Promise<AdminOrderFinancialMutationResult>;
};

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApprovalTerminalCommandError('approval_order_payload_invalid');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApprovalTerminalCommandError('approval_order_payload_invalid');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ApprovalTerminalCommandError('approval_order_payload_invalid');
  }
  return value;
}

function executionBase(
  claim: AdminApprovalExecutionClaim,
  payload: Readonly<Record<string, unknown>>,
): OrderApprovalExecutionBase {
  if (!claim.shopId) {
    throw new ApprovalTerminalCommandError('approval_order_payload_invalid');
  }
  return {
    approvalRequestId: claim.approvalRequestId,
    businessId: claim.businessId,
    shopId: claim.shopId,
    requesterEmployeeId: claim.requesterEmployeeId,
    approverEmployeeId: claim.approverEmployeeId,
    orderId: requiredString(payload['orderId']),
    reasonCodeId: requiredString(payload['reasonCodeId']),
    note: nullableString(payload['note']),
    orderCommandId: requiredString(payload['orderCommandId']),
  };
}

function refundInput(
  claim: AdminApprovalExecutionClaim,
  payloadValue: Readonly<Record<string, unknown>>,
): ApprovedRefundExecutionInput {
  return {
    ...executionBase(claim, payloadValue),
    paymentId: requiredString(payloadValue['paymentId']),
    amountMinor: positiveInteger(payloadValue['amountMinor']),
  };
}

function returnInput(
  claim: AdminApprovalExecutionClaim,
  payloadValue: Readonly<Record<string, unknown>>,
): ApprovedReturnExecutionInput {
  const base = executionBase(claim, payloadValue);
  const rawItems = payloadValue['items'];
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ApprovalTerminalCommandError('approval_order_payload_invalid');
  }
  const items = rawItems.map((itemValue) => {
    const item = record(itemValue);
    return {
      orderItemId: requiredString(item['orderItemId']),
      quantity: positiveInteger(item['quantity']),
    };
  });
  return { ...base, items };
}

function asExecutionResult(result: AdminOrderFinancialMutationResult) {
  if (!result.ok) {
    throw new ApprovalTerminalCommandError(result.code);
  }
  if (result.state !== 'POSTED') {
    throw new ApprovalTerminalCommandError('approval_order_execution_not_posted');
  }
  return { result, idempotentReplay: result.replayed };
}

export function createOrderApprovalExecutionEntries(
  deps: OrderApprovalExecutionDependencies,
): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: ORDER_REFUND_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        return asExecutionResult(await deps.executeRefund(refundInput(claim, record(payload))));
      },
    },
    {
      actionType: ORDER_RETURN_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        return asExecutionResult(await deps.executeReturn(returnInput(claim, record(payload))));
      },
    },
  ];
}
