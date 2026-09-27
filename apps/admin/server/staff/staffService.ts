import type {
  AdminSessionPrincipal,
  CorrectAttendanceInput,
  RecordStaffPaymentInput,
  StaffCommandResult,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export class StaffServiceError extends Error {
  constructor(readonly code: 'attendance_correction_reason_required' | 'finance_account_required') {
    super(code);
    this.name = 'StaffServiceError';
  }
}

export interface StaffStore {
  correctAttendance(
    input: CorrectAttendanceInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  recordPayment(
    input: RecordStaffPaymentInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
}

export function createStaffService(store: StaffStore) {
  return {
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
      return store.recordPayment({
        ...input,
        actorEmployeeId: principal.employeeId,
      });
    },
  };
}

export function createSupabaseStaffStore(client: AdminSupabaseClient): StaffStore {
  return {
    correctAttendance(input) {
      return client.rpc<StaffCommandResult>('correct_attendance_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_attendance_event_id: input.attendanceEventId,
        p_corrected_occurred_at: input.correctedOccurredAt,
        p_reason: input.reason,
        p_command_id: input.commandId,
      });
    },

    recordPayment(input) {
      return client.rpc<StaffCommandResult>('record_staff_payment_v1', {
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
      });
    },
  };
}
