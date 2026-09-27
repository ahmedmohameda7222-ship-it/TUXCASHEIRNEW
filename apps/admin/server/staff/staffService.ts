import type {
  AdminSessionPrincipal,
  AssignEmployeeShopInput,
  CancelShiftInput,
  CopyPreviousWeekInput,
  CorrectAttendanceInput,
  CreateEmployeeInput,
  CreateLeaveRequestInput,
  CreateShiftInput,
  DecideLeaveRequestInput,
  EmployeeDetail,
  LinkEmployeeWorkerInput,
  ReactivateEmployeeInput,
  RecordStaffPaymentInput,
  SetCompensationInput,
  SetEmployeePermissionInput,
  SetEmployeeRoleInput,
  StaffCommandResult,
  StaffWorkspace,
  SuspendEmployeeInput,
  UpdateEmployeeProfileInput,
  UpdateShiftInput,
} from '@tux/admin-contracts';

import {
  requireBusinessWidePermission,
  requirePermission,
} from '../authorization.js';
import type { StaffStore } from './staffStore.js';

export { createSupabaseStaffStore } from './staffStore.js';
export type { StaffStore } from './staffStore.js';

export class StaffServiceError extends Error {
  constructor(
    readonly code:
      | 'attendance_correction_reason_required'
      | 'finance_account_required'
      | 'leave_shop_scope_required',
  ) {
    super(code);
    this.name = 'StaffServiceError';
  }
}

function actorInput<T extends object>(
  input: T,
  principal: AdminSessionPrincipal,
): T & { actorEmployeeId: string } {
  return { ...input, actorEmployeeId: principal.employeeId };
}

export function createStaffService(store: StaffStore) {
  return {
    async loadWorkspace(
      shopId: string,
      principal: AdminSessionPrincipal,
    ): Promise<StaffWorkspace> {
      requirePermission(principal, 'staff.view', shopId);
      const workspace = await store.loadWorkspace(shopId, principal.businessId);
      return principal.permissions.includes('staff.payments')
        ? workspace
        : { ...workspace, financeAccounts: [] };
    },

    async loadEmployeeDetail(
      input: { employeeId: string; shopId: string },
      principal: AdminSessionPrincipal,
    ): Promise<EmployeeDetail | null> {
      requirePermission(principal, 'staff.view', input.shopId);
      return store.loadEmployeeDetail({
        ...input,
        businessId: principal.businessId,
      });
    },

    createEmployee(
      input: CreateEmployeeInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.createEmployee(actorInput(input, principal));
    },

    updateEmployeeProfile(
      input: UpdateEmployeeProfileInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.updateEmployeeProfile(actorInput(input, principal));
    },

    assignEmployeeShop(
      input: AssignEmployeeShopInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.assignEmployeeShop(actorInput(input, principal));
    },

    linkEmployeeWorker(
      input: LinkEmployeeWorkerInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.linkEmployeeWorker(actorInput(input, principal));
    },

    setEmployeeRole(
      input: SetEmployeeRoleInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.setEmployeeRole(actorInput(input, principal));
    },

    setEmployeePermission(
      input: SetEmployeePermissionInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requireBusinessWidePermission(principal, 'staff.manage', input.shopId);
      return store.setEmployeePermission(actorInput(input, principal));
    },

    suspendEmployee(
      input: SuspendEmployeeInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.suspendEmployee(actorInput(input, principal));
    },

    reactivateEmployee(
      input: ReactivateEmployeeInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.reactivateEmployee(actorInput(input, principal));
    },

    setCompensation(
      input: SetCompensationInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.setCompensation(actorInput(input, principal));
    },

    createShift(
      input: CreateShiftInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.createShift(actorInput(input, principal));
    },

    updateShift(
      input: UpdateShiftInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.updateShift(actorInput(input, principal));
    },

    cancelShift(
      input: CancelShiftInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.cancelShift(actorInput(input, principal));
    },

    copyPreviousWeek(
      input: CopyPreviousWeekInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.copyPreviousWeek(actorInput(input, principal));
    },

    createLeave(
      input: CreateLeaveRequestInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      if (input.shopId === null) {
        requireBusinessWidePermission(principal, 'staff.manage');
      } else {
        requirePermission(principal, 'staff.manage', input.shopId);
      }
      return store.createLeave(actorInput(input, principal));
    },

    decideLeave(
      input: DecideLeaveRequestInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      return store.decideLeave(actorInput(input, principal));
    },

    async correctAttendance(
      input: CorrectAttendanceInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.manage', input.shopId);
      if (input.reason.trim() === '') {
        throw new StaffServiceError('attendance_correction_reason_required');
      }
      return store.correctAttendance({
        ...input,
        reason: input.reason.trim(),
        actorEmployeeId: principal.employeeId,
      });
    },

    async recordPayment(
      input: RecordStaffPaymentInput,
      principal: AdminSessionPrincipal,
    ): Promise<StaffCommandResult> {
      requirePermission(principal, 'staff.payments', input.shopId);
      if (input.financeAccountId.trim() === '') {
        throw new StaffServiceError('finance_account_required');
      }
      return store.recordPayment(actorInput(input, principal));
    },
  };
}
