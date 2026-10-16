import type { AdminOrderFinancialMutationResult } from '@tux/admin-contracts';

import { getAdminServerEnv } from '../env.js';
import type { AdminInventoryCommandResult } from '@tux/admin-contracts';
import {
  createInventoryAdjustmentApprovalExecutionEntries,
  type ApprovedInventoryAdjustmentExecutionInput,
} from '../inventory/inventoryApproval.js';
import {
  createOrderApprovalExecutionEntries,
  type ApprovedRefundExecutionInput,
  type ApprovedReturnExecutionInput,
} from '../orders/orderApproval.js';
import {
  createStaffApprovalExecutionEntries,
  createSupabaseStaffApprovalExecutionDependencies,
} from '../staff/staffApproval.js';
import { AdminSupabaseClient } from '../supabaseAdmin.js';
import {
  createCashierReconciliationApprovalExecutionEntries,
  type ApprovedCashierReconciliationInput,
  type CashierReconciliationMutationResult,
} from './financeCashierReconciliationApproval.js';
import {
  createOwnerWithdrawalApprovalExecutionEntries,
  type ApprovedOwnerWithdrawalInput,
  type OwnerWithdrawalMutationResult,
} from './financeOwnerWithdrawalApproval.js';
import {
  createFinanceSnapshotApprovalExecutionEntries,
  type ApprovedFinanceSnapshotExecutionInput,
  type ApprovedFinanceSnapshotMutationResult,
} from './financeSnapshotApproval.js';
import {
  createSettingsPaymentZoneApprovalExecutionEntries,
  type ApprovedSettingsPaymentZoneChange,
  type SettingsPaymentZoneMutationResult,
} from './settingsPaymentZoneApproval.js';
import {
  createSettingsPaymentMethodApprovalExecutionEntries,
  type ApprovedSettingsPaymentMethodUpdate,
  type SettingsPaymentMethodMutationResult,
} from './settingsPaymentMethodApproval.js';
import {
  createShopLifecycleApprovalExecutionEntries,
  type ApprovedShopLifecycleInput,
  type ApprovedShopLifecycleMutationResult,
} from './shopLifecycleApproval.js';
import {
  createApprovalExecutionRegistry,
  createApprovalExecutionService,
  createSupabaseApprovalExecutionDependencies,
  type ApprovalExecutionRunResult,
} from './approvalExecutionService.js';

export type ApprovalExecutionHttpResult = {
  statusCode: number;
  body: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, string>>;
};

export type ApprovalExecutionRequestInput = {
  method?: string | undefined;
  authorization?: string | undefined;
  cronSecret?: string | undefined;
  run(): Promise<ApprovalExecutionRunResult>;
};

export async function handleApprovalExecutionRequest(
  input: ApprovalExecutionRequestInput,
): Promise<ApprovalExecutionHttpResult> {
  const method = (input.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return {
      statusCode: 405,
      body: { error: 'method_not_allowed' },
      headers: { allow: 'GET, POST' },
    };
  }

  const cronSecret = input.cronSecret?.trim() ?? '';
  if (cronSecret === '') {
    return { statusCode: 503, body: { error: 'cron_secret_not_configured' } };
  }
  if (input.authorization !== `Bearer ${cronSecret}`) {
    return { statusCode: 401, body: { error: 'unauthorized' } };
  }

  try {
    const result = await input.run();
    return { statusCode: 200, body: result };
  } catch {
    return { statusCode: 500, body: { error: 'approval_executor_failed' } };
  }
}

export async function runApprovalExecutionRunner(input: {
  execute(): Promise<ApprovalExecutionRunResult>;
}): Promise<ApprovalExecutionRunResult> {
  return input.execute();
}

function createOrderApprovalPersistence(client: AdminSupabaseClient) {
  return {
    executeRefund(input: ApprovedRefundExecutionInput) {
      return client.rpc<AdminOrderFinancialMutationResult>(
        'execute_approved_admin_order_refund_v1',
        {
          p_approval_request_id: input.approvalRequestId,
          p_business_id: input.businessId,
          p_shop_id: input.shopId,
          p_requester_employee_id: input.requesterEmployeeId,
          p_approver_employee_id: input.approverEmployeeId,
          p_order_id: input.orderId,
          p_payment_id: input.paymentId,
          p_amount_minor: input.amountMinor,
          p_reason_code_id: input.reasonCodeId,
          p_note: input.note,
          p_command_id: input.orderCommandId,
        },
      );
    },
    executeReturn(input: ApprovedReturnExecutionInput) {
      return client.rpc<AdminOrderFinancialMutationResult>(
        'execute_approved_admin_order_return_v1',
        {
          p_approval_request_id: input.approvalRequestId,
          p_business_id: input.businessId,
          p_shop_id: input.shopId,
          p_requester_employee_id: input.requesterEmployeeId,
          p_approver_employee_id: input.approverEmployeeId,
          p_order_id: input.orderId,
          p_items: input.items,
          p_reason_code_id: input.reasonCodeId,
          p_note: input.note,
          p_command_id: input.orderCommandId,
        },
      );
    },
  };
}

export async function runProductionApprovalExecutionRunner(): Promise<ApprovalExecutionRunResult> {
  const client = new AdminSupabaseClient(getAdminServerEnv());
  const persistence = createSupabaseApprovalExecutionDependencies(client);
  const registry = createApprovalExecutionRegistry([
    ...createOrderApprovalExecutionEntries(createOrderApprovalPersistence(client)),
    ...createInventoryAdjustmentApprovalExecutionEntries({
      executeAdjustment(input: ApprovedInventoryAdjustmentExecutionInput) {
        return client.rpc<AdminInventoryCommandResult>(
          'execute_approved_admin_inventory_adjustment_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_inventory_item_id: input.inventoryItemId,
            p_quantity_delta_micros: input.quantityDeltaMicros,
            p_reason_code_id: input.reasonCodeId,
            p_note: input.note,
            p_command_id: input.originalCommandId,
            p_emergency_negative_override: input.emergencyNegativeOverride,
            p_expected_definition_version: input.expectedDefinitionVersion,
            p_expected_movement_count: input.expectedMovementCount,
          },
        );
      },
    }),
    ...createStaffApprovalExecutionEntries(
      createSupabaseStaffApprovalExecutionDependencies(client),
    ),
    ...createCashierReconciliationApprovalExecutionEntries({
      executeReconciliation(input: ApprovedCashierReconciliationInput) {
        return client.rpc<CashierReconciliationMutationResult>(
          'execute_approved_admin_cashier_reconciliation_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_business_day_id: input.businessDayId,
            p_cashier_worker_id: input.cashierWorkerId,
            p_actual_minor: input.actualMinor,
            p_expected_minor: input.expectedMinor,
            p_reason: input.reason,
            p_original_command_id: input.commandId,
            p_approval_command_id: input.approvalCommandId,
          },
        );
      },
    }),
    ...createOwnerWithdrawalApprovalExecutionEntries({
      executeWithdrawal(input: ApprovedOwnerWithdrawalInput) {
        return client.rpc<OwnerWithdrawalMutationResult>(
          'execute_approved_admin_owner_withdrawal_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_account_id: input.accountId,
            p_amount_minor: input.amountMinor,
            p_reason: input.reason,
            p_original_command_id: input.commandId,
            p_approval_command_id: input.approvalCommandId,
          },
        );
      },
    }),
    ...createFinanceSnapshotApprovalExecutionEntries({
      executeAdjustment(input: ApprovedFinanceSnapshotExecutionInput) {
        return client.rpc<ApprovedFinanceSnapshotMutationResult>(
          'execute_approved_admin_finance_snapshot_adjustment_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_snapshot_id: input.snapshotId,
            p_amount_minor: input.amountMinor,
            p_reason: input.reason,
            p_original_command_id: input.commandId,
            p_expected_adjustment_count: input.expectedAdjustmentCount,
            p_command_id: input.approvalCommandId,
          },
        );
      },
    }),
    ...createSettingsPaymentZoneApprovalExecutionEntries({
      executeChange(input: ApprovedSettingsPaymentZoneChange) {
        return client.rpc<SettingsPaymentZoneMutationResult>(
          'execute_approved_admin_payment_zone_rule_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_payment_method_id: input.paymentMethodId,
            p_delivery_zone_id: input.deliveryZoneId,
            p_allowed: input.allowed,
            p_expected_allowed: input.expectedAllowed,
            p_expected_settings_version: input.expectedSettingsVersion,
            p_command_id: input.approvalCommandId,
          },
        );
      },
    }),
    ...createSettingsPaymentMethodApprovalExecutionEntries({
      executeUpdate(input: ApprovedSettingsPaymentMethodUpdate) {
        return client.rpc<SettingsPaymentMethodMutationResult>(
          'execute_approved_admin_payment_method_update_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_payment_method_id: input.paymentMethodId,
            p_display_name: input.displayName,
            p_active: input.active,
            p_sort_order: input.sortOrder,
            p_channel: input.channel,
            p_requires_reference: input.requiresReference,
            p_manual_confirmation_required: input.manualConfirmationRequired,
            p_refund_allowed: input.refundAllowed,
            p_expected_settings_version: input.expectedSettingsVersion,
            p_expected_edit_version: input.expectedEditVersion,
            p_command_id: input.approvalCommandId,
          },
        );
      },
    }),
    ...createShopLifecycleApprovalExecutionEntries({
      executeLifecycle(input: ApprovedShopLifecycleInput) {
        return client.rpc<ApprovedShopLifecycleMutationResult>(
          'execute_approved_admin_shop_lifecycle_v1',
          {
            p_approval_request_id: input.approvalRequestId,
            p_business_id: input.businessId,
            p_shop_id: input.shopId,
            p_requester_employee_id: input.requesterEmployeeId,
            p_approver_employee_id: input.approverEmployeeId,
            p_expected_lifecycle_revision: input.expectedLifecycleRevision,
            p_expected_state: input.expectedState,
            p_target_state: input.targetState,
            p_command_id: input.originalCommandId,
          },
        );
      },
    }),
  ]);
  const service = createApprovalExecutionService({
    ...persistence,
    registry,
    workerId: 'admin-approval-executor',
    batchLimit: 25,
    leaseSeconds: 300,
  });

  return runApprovalExecutionRunner({ execute: () => service.runOnce() });
}
