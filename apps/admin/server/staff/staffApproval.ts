import type { AdminRole } from '@tux/admin-contracts';

import type { ApprovalCommandRegistryEntry } from '../approvals/approvalService.js';
import {
  ApprovalTerminalCommandError,
  type ApprovalExecutionRegistryEntry,
} from '../approvals/approvalExecutionService.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export const EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION = 'EMPLOYEE_PIN_CHANGE';
export const EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION = 'EMPLOYEE_ROLE_CHANGE';
export const EMPLOYEE_PERMISSION_CHANGE_APPROVAL_ACTION = 'EMPLOYEE_PERMISSION_CHANGE';
export const EMPLOYEE_SUSPEND_APPROVAL_ACTION = 'EMPLOYEE_SUSPEND';
export const STAFF_PAYMENT_APPROVAL_ACTION = 'STAFF_PAYMENT';

type StaffApprovalExecutionResult = Readonly<Record<string, unknown>> & {
  readonly ok: boolean;
  readonly code?: string;
  readonly replayed?: boolean;
};

export type StaffApprovalExecutionDependencies = {
  applyEmployeePinChange(input: {
    actorEmployeeId: string;
    employeeId: string;
    businessId: string;
    targetShopIds: readonly string[];
    expectedCredentialVersion: number;
    commandRef: string;
    approvalRequestId: string;
  }): Promise<StaffApprovalExecutionResult>;
  setEmployeeRole(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    role: AdminRole;
    commandId: string;
    approvalRequestId: string;
  }): Promise<StaffApprovalExecutionResult>;
  setEmployeePermission(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    permissionKey: string;
    effect: 'ALLOW' | 'DENY';
    commandId: string;
    approvalRequestId: string;
  }): Promise<StaffApprovalExecutionResult>;
  suspendEmployee(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    commandId: string;
    approvalRequestId: string;
  }): Promise<StaffApprovalExecutionResult>;
  recordStaffPayment(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    payPeriodStart: string;
    payPeriodEnd: string;
    expectedAmountMinor: number;
    paidAmountMinor: number;
    financeAccountId: string;
    paymentDate: string;
    note: string | null;
    reference: string | null;
    commandId: string;
    approvalRequestId: string;
  }): Promise<StaffApprovalExecutionResult>;
};

function record(
  value: unknown,
  code = 'approval_staff_payload_invalid',
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApprovalTerminalCommandError(code);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return value;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  const values = value.map(requiredString);
  if (new Set(values).size !== values.length) {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return values;
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  code = 'approval_staff_payload_invalid',
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ApprovalTerminalCommandError(code);
  }
}

function assertPinPayloadHasNoSecretMaterial(value: Readonly<Record<string, unknown>>): void {
  const forbidden = /(pin|verifier|lookup|salt|password|passcode|secret|token)/i;
  if (Object.keys(value).some((key) => forbidden.test(key))) {
    throw new Error('approval_pin_payload_unsafe');
  }
}

function pinApprovalPayload(input: unknown): Readonly<Record<string, unknown>> {
  const value = record(input);
  assertPinPayloadHasNoSecretMaterial(value);
  assertOnlyKeys(
    value,
    ['employeeId', 'targetShopIds', 'expectedCredentialVersion', 'commandRef'],
    'approval_pin_payload_unsafe',
  );
  return {
    employeeId: requiredString(value['employeeId']),
    targetShopIds: stringArray(value['targetShopIds']),
    expectedCredentialVersion: positiveInteger(value['expectedCredentialVersion']),
    commandRef: requiredString(value['commandRef']),
  };
}

function roleApprovalPayload(input: unknown): Readonly<Record<string, unknown>> {
  const value = record(input);
  assertOnlyKeys(value, ['employeeId', 'shopId', 'expectedVersion', 'role']);
  const role = requiredString(value['role']);
  if (!['OWNER', 'ADMIN', 'MANAGER', 'STAFF'].includes(role)) {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return {
    employeeId: requiredString(value['employeeId']),
    shopId: requiredString(value['shopId']),
    expectedVersion: positiveInteger(value['expectedVersion']),
    role,
  };
}

function permissionApprovalPayload(input: unknown): Readonly<Record<string, unknown>> {
  const value = record(input);
  assertOnlyKeys(value, [
    'employeeId',
    'shopId',
    'expectedVersion',
    'permissionKey',
    'effect',
  ]);
  const effect = requiredString(value['effect']);
  if (effect !== 'ALLOW' && effect !== 'DENY') {
    throw new ApprovalTerminalCommandError('approval_staff_payload_invalid');
  }
  return {
    employeeId: requiredString(value['employeeId']),
    shopId: requiredString(value['shopId']),
    expectedVersion: positiveInteger(value['expectedVersion']),
    permissionKey: requiredString(value['permissionKey']),
    effect,
  };
}

function suspensionApprovalPayload(input: unknown): Readonly<Record<string, unknown>> {
  const value = record(input);
  assertOnlyKeys(value, ['employeeId', 'shopId', 'expectedVersion']);
  return {
    employeeId: requiredString(value['employeeId']),
    shopId: requiredString(value['shopId']),
    expectedVersion: positiveInteger(value['expectedVersion']),
  };
}

function paymentApprovalPayload(input: unknown): Readonly<Record<string, unknown>> {
  const value = record(input);
  assertOnlyKeys(value, [
    'employeeId',
    'shopId',
    'payPeriodStart',
    'payPeriodEnd',
    'expectedAmountMinor',
    'paidAmountMinor',
    'financeAccountId',
    'paymentDate',
    'note',
    'reference',
  ]);
  return {
    employeeId: requiredString(value['employeeId']),
    shopId: requiredString(value['shopId']),
    payPeriodStart: requiredString(value['payPeriodStart']),
    payPeriodEnd: requiredString(value['payPeriodEnd']),
    expectedAmountMinor: nonNegativeInteger(value['expectedAmountMinor']),
    paidAmountMinor: nonNegativeInteger(value['paidAmountMinor']),
    financeAccountId: requiredString(value['financeAccountId']),
    paymentDate: requiredString(value['paymentDate']),
    note: nullableString(value['note']),
    reference: nullableString(value['reference']),
  };
}

export function createStaffApprovalCommandEntries(): readonly ApprovalCommandRegistryEntry[] {
  return [
    {
      actionType: EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
      containsSecretInput: true,
      serialize: pinApprovalPayload,
    },
    {
      actionType: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize: roleApprovalPayload,
    },
    {
      actionType: EMPLOYEE_PERMISSION_CHANGE_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize: permissionApprovalPayload,
    },
    {
      actionType: EMPLOYEE_SUSPEND_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize: suspensionApprovalPayload,
    },
    {
      actionType: STAFF_PAYMENT_APPROVAL_ACTION,
      containsSecretInput: false,
      serialize: paymentApprovalPayload,
    },
  ];
}

function ensureClaimShop(claimShopId: string | null, payloadShopId: string): string {
  if (claimShopId !== null && claimShopId !== payloadShopId) {
    throw new ApprovalTerminalCommandError('approval_staff_shop_scope_invalid');
  }
  return payloadShopId;
}

function asExecutionResult(result: StaffApprovalExecutionResult) {
  if (result['ok'] !== true) {
    const code =
      typeof result['code'] === 'string' ? result['code'] : 'approval_staff_execution_failed';
    throw new ApprovalTerminalCommandError(code);
  }
  return {
    result,
    idempotentReplay: result['replayed'] === true,
  };
}

export function createStaffApprovalExecutionEntries(
  deps: StaffApprovalExecutionDependencies,
): readonly ApprovalExecutionRegistryEntry[] {
  return [
    {
      actionType: EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const value = pinApprovalPayload(payload);
        const targetShopIds = value['targetShopIds'] as readonly string[];
        if (claim.shopId !== null && !targetShopIds.includes(claim.shopId)) {
          throw new ApprovalTerminalCommandError('approval_staff_shop_scope_invalid');
        }
        return asExecutionResult(
          await deps.applyEmployeePinChange({
            actorEmployeeId: claim.requesterEmployeeId,
            employeeId: value['employeeId'] as string,
            businessId: claim.businessId,
            targetShopIds,
            expectedCredentialVersion: value['expectedCredentialVersion'] as number,
            commandRef: value['commandRef'] as string,
            approvalRequestId: claim.approvalRequestId,
          }),
        );
      },
    },
    {
      actionType: EMPLOYEE_ROLE_CHANGE_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const value = roleApprovalPayload(payload);
        return asExecutionResult(
          await deps.setEmployeeRole({
            actorEmployeeId: claim.requesterEmployeeId,
            employeeId: value['employeeId'] as string,
            shopId: ensureClaimShop(claim.shopId, value['shopId'] as string),
            expectedVersion: value['expectedVersion'] as number,
            role: value['role'] as AdminRole,
            commandId: claim.commandId,
            approvalRequestId: claim.approvalRequestId,
          }),
        );
      },
    },
    {
      actionType: EMPLOYEE_PERMISSION_CHANGE_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const value = permissionApprovalPayload(payload);
        return asExecutionResult(
          await deps.setEmployeePermission({
            actorEmployeeId: claim.requesterEmployeeId,
            employeeId: value['employeeId'] as string,
            shopId: ensureClaimShop(claim.shopId, value['shopId'] as string),
            expectedVersion: value['expectedVersion'] as number,
            permissionKey: value['permissionKey'] as string,
            effect: value['effect'] as 'ALLOW' | 'DENY',
            commandId: claim.commandId,
            approvalRequestId: claim.approvalRequestId,
          }),
        );
      },
    },
    {
      actionType: EMPLOYEE_SUSPEND_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const value = suspensionApprovalPayload(payload);
        return asExecutionResult(
          await deps.suspendEmployee({
            actorEmployeeId: claim.requesterEmployeeId,
            employeeId: value['employeeId'] as string,
            shopId: ensureClaimShop(claim.shopId, value['shopId'] as string),
            expectedVersion: value['expectedVersion'] as number,
            commandId: claim.commandId,
            approvalRequestId: claim.approvalRequestId,
          }),
        );
      },
    },
    {
      actionType: STAFF_PAYMENT_APPROVAL_ACTION,
      async execute({ payload, claim }) {
        const value = paymentApprovalPayload(payload);
        return asExecutionResult(
          await deps.recordStaffPayment({
            actorEmployeeId: claim.requesterEmployeeId,
            employeeId: value['employeeId'] as string,
            shopId: ensureClaimShop(claim.shopId, value['shopId'] as string),
            payPeriodStart: value['payPeriodStart'] as string,
            payPeriodEnd: value['payPeriodEnd'] as string,
            expectedAmountMinor: value['expectedAmountMinor'] as number,
            paidAmountMinor: value['paidAmountMinor'] as number,
            financeAccountId: value['financeAccountId'] as string,
            paymentDate: value['paymentDate'] as string,
            note: value['note'] as string | null,
            reference: value['reference'] as string | null,
            commandId: claim.commandId,
            approvalRequestId: claim.approvalRequestId,
          }),
        );
      },
    },
  ];
}

function rpcResult(value: Readonly<Record<string, unknown>>): StaffApprovalExecutionResult {
  return {
    ...value,
    ok: value['ok'] === true,
    ...(typeof value['code'] === 'string' ? { code: value['code'] } : {}),
    ...(typeof value['replayed'] === 'boolean' ? { replayed: value['replayed'] } : {}),
  };
}

export function createSupabaseStaffApprovalExecutionDependencies(
  client: AdminSupabaseClient,
): StaffApprovalExecutionDependencies {
  return {
    async applyEmployeePinChange(input) {
      return rpcResult(
        await client.rpc<Readonly<Record<string, unknown>>>('apply_employee_pin_change_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_command_ref: input.commandRef,
        }),
      );
    },
    async setEmployeeRole(input) {
      return rpcResult(
        await client.rpc<Readonly<Record<string, unknown>>>('set_employee_role_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_employee_id: input.employeeId,
          p_shop_id: input.shopId,
          p_expected_profile_version: input.expectedVersion,
          p_role: input.role,
          p_command_id: input.commandId,
        }),
      );
    },
    async setEmployeePermission(input) {
      return rpcResult(
        await client.rpc<Readonly<Record<string, unknown>>>('set_employee_permission_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_employee_id: input.employeeId,
          p_shop_id: input.shopId,
          p_expected_profile_version: input.expectedVersion,
          p_permission_key: input.permissionKey,
          p_effect: input.effect,
          p_command_id: input.commandId,
        }),
      );
    },
    async suspendEmployee(input) {
      return rpcResult(
        await client.rpc<Readonly<Record<string, unknown>>>('suspend_employee_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_employee_id: input.employeeId,
          p_expected_profile_version: input.expectedVersion,
          p_command_id: input.commandId,
        }),
      );
    },
    async recordStaffPayment(input) {
      return rpcResult(
        await client.rpc<Readonly<Record<string, unknown>>>('record_staff_payment_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_employee_id: input.employeeId,
          p_shop_id: input.shopId,
          p_pay_period_start: input.payPeriodStart,
          p_pay_period_end: input.payPeriodEnd,
          p_expected_amount_minor: input.expectedAmountMinor,
          p_paid_amount_minor: input.paidAmountMinor,
          p_finance_account_id: input.financeAccountId,
          p_payment_date: input.paymentDate,
          p_note: input.note,
          p_reference: input.reference,
          p_command_id: input.commandId,
        }),
      );
    },
  };
}
