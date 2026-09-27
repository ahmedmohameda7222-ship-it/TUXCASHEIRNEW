import type { AdminPermission, AdminRole } from './auth';

export const STAFF_COMPENSATION_TYPES = ['HOURLY', 'MONTHLY'] as const;
export type StaffCompensationType = (typeof STAFF_COMPENSATION_TYPES)[number];

export const STAFF_SHIFT_STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
export type StaffShiftStatus = (typeof STAFF_SHIFT_STATUSES)[number];

export const ATTENDANCE_EVENT_TYPES = ['SESSION_START', 'SESSION_END'] as const;
export type AttendanceEventType = (typeof ATTENDANCE_EVENT_TYPES)[number];

export const STAFF_LEAVE_TYPES = ['VACATION', 'SICK', 'UNPAID', 'OTHER'] as const;
export type StaffLeaveType = (typeof STAFF_LEAVE_TYPES)[number];

export const STAFF_LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type StaffLeaveStatus = (typeof STAFF_LEAVE_STATUSES)[number];

export type EmployeeShopAssignment = {
  readonly shopId: string;
  readonly assigned: boolean;
};

export type LinkedOperationsIdentityState =
  | {
      readonly kind: 'LINKED';
      readonly shopId: string;
      readonly workerId: string;
      readonly workerName: string;
      readonly workerActive: boolean;
      readonly credentialVersion: number;
    }
  | {
      readonly kind: 'SETUP_REQUIRED';
      readonly shopId: string;
    };

export type EmployeeCompensation = {
  readonly id: string;
  readonly employeeId: string;
  readonly compensationType: StaffCompensationType;
  readonly rateMinor: number;
  readonly effectiveFrom: string;
  readonly version: number;
  readonly createdAt: string;
};

export type EmployeeShift = {
  readonly id: string;
  readonly employeeId: string;
  readonly shopId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly plannedBreakMinutes: number;
  readonly status: StaffShiftStatus;
  readonly version: number;
  readonly sourceShiftId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type AttendanceEvent = {
  readonly id: string;
  readonly employeeId: string;
  readonly shopId: string;
  readonly workerId: string;
  readonly workerSessionId: string;
  readonly eventType: AttendanceEventType;
  readonly occurredAt: string;
  readonly createdAt: string;
};

export type AttendanceCorrection = {
  readonly id: string;
  readonly employeeId: string;
  readonly shopId: string;
  readonly attendanceEventId: string;
  readonly originalOccurredAt: string;
  readonly correctedOccurredAt: string;
  readonly reason: string;
  readonly correctedByEmployeeId: string;
  readonly createdAt: string;
};

export type AttendanceSummary = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly scheduledShiftId: string | null;
  readonly scheduledStartsAt: string | null;
  readonly scheduledEndsAt: string | null;
  readonly plannedBreakMinutes: number;
  readonly actualStartsAt: string | null;
  readonly actualEndsAt: string | null;
  readonly workedMinutes: number;
  readonly lateMinutes: number;
  readonly leftEarlyMinutes: number;
  readonly overtimeMinutes: number;
  readonly absent: boolean;
};

export type LeaveRequest = {
  readonly id: string;
  readonly employeeId: string;
  readonly shopId: string | null;
  readonly leaveType: StaffLeaveType;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly note: string | null;
  readonly status: StaffLeaveStatus;
  readonly requesterEmployeeId: string;
  readonly decidedByEmployeeId: string | null;
  readonly decisionReason: string | null;
  readonly decidedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WageEstimate = {
  readonly employeeId: string;
  readonly compensationType: StaffCompensationType;
  readonly rateMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly workedMinutes: number;
  readonly overtimeMinutes: number;
  readonly overtimeMultiplierBasisPoints: number;
  readonly estimatedAmountMinor: number;
  readonly statutoryPayroll: false;
};

export type StaffPaymentRecord = {
  readonly id: string;
  readonly employeeId: string;
  readonly shopId: string;
  readonly payPeriodStart: string;
  readonly payPeriodEnd: string;
  readonly expectedAmountMinor: number;
  readonly paidAmountMinor: number;
  readonly financeAccountId: string;
  readonly financeMovementId: string;
  readonly paymentDate: string;
  readonly note: string | null;
  readonly reference: string | null;
  readonly actorEmployeeId: string;
  readonly createdAt: string;
};

export type StaffFinanceAccountChoice = {
  readonly id: string;
  readonly shopId: string | null;
  readonly accountType: 'CASH' | 'BANK' | 'WALLET' | 'PENDING_SETTLEMENT';
  readonly name: string;
};

export type StaffWorkerChoice = {
  readonly id: string;
  readonly shopId: string;
  readonly displayName: string;
  readonly linkedEmployeeId: string | null;
};

export type EmployeeSummary = {
  readonly id: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly role: AdminRole;
  readonly active: boolean;
  readonly shopIds: readonly string[];
  readonly operationsSetupRequiredShopIds: readonly string[];
};

export type EmployeeDetail = {
  readonly id: string;
  readonly businessId: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly hireDate: string | null;
  readonly notes: string | null;
  readonly role: AdminRole;
  readonly active: boolean;
  readonly profileVersion: number;
  readonly credentialVersion: number;
  readonly customPermissions: readonly AdminPermission[];
  readonly assignments: readonly EmployeeShopAssignment[];
  readonly operationsIdentities: readonly LinkedOperationsIdentityState[];
  readonly compensation: readonly EmployeeCompensation[];
  readonly shifts: readonly EmployeeShift[];
  readonly attendanceEvents: readonly AttendanceEvent[];
  readonly attendanceCorrections: readonly AttendanceCorrection[];
  readonly attendanceSummaries: readonly AttendanceSummary[];
  readonly leaveRequests: readonly LeaveRequest[];
  readonly payments: readonly StaffPaymentRecord[];
};

export type StaffListResult = {
  readonly rows: readonly EmployeeSummary[];
  readonly nextCursor: string | null;
};

export type StaffWorkspace = {
  readonly employees: StaffListResult;
  readonly financeAccounts: readonly StaffFinanceAccountChoice[];
  readonly workers: readonly StaffWorkerChoice[];
};

export type StaffCommandResult =
  | {
      readonly ok: true;
      readonly replayed?: boolean;
      readonly employeeId?: string;
      readonly shiftId?: string;
      readonly leaveRequestId?: string;
      readonly correctionId?: string;
      readonly staffPaymentRecordId?: string;
      readonly financeMovementId?: string;
      readonly commandRef?: string;
      readonly version?: number;
      readonly profileVersion?: number;
      readonly credentialVersion?: number;
      readonly compensationId?: string;
      readonly copiedCount?: number;
      readonly approvalRequestId?: string;
      readonly state?: 'APPLIED' | 'PENDING_APPROVAL';
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly currentVersion?: number;
    };

export type CreateEmployeeInput = {
  readonly shopId: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly hireDate: string | null;
  readonly notes: string | null;
  readonly role: AdminRole;
  readonly commandId: string;
};

export type UpdateEmployeeProfileInput = {
  readonly shopId: string;
  readonly employeeId: string;
  readonly expectedVersion: number;
  readonly displayName: string;
  readonly phone: string | null;
  readonly hireDate: string | null;
  readonly notes: string | null;
  readonly commandId: string;
};

export type AssignEmployeeShopInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly commandId: string;
};

export type LinkEmployeeWorkerInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly workerId: string;
  readonly commandId: string;
};

export type SetEmployeeRoleInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly role: AdminRole;
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type SetEmployeePermissionsInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly permissions: readonly AdminPermission[];
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type SetEmployeePermissionInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly permissionKey: AdminPermission;
  readonly effect: 'ALLOW' | 'DENY';
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type SuspendEmployeeInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type ReactivateEmployeeInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type SetCompensationInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly compensationType: StaffCompensationType;
  readonly rateMinor: number;
  readonly effectiveFrom: string;
  readonly commandId: string;
};

export type CreateShiftInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly plannedBreakMinutes: number;
  readonly commandId: string;
};

export type UpdateShiftInput = {
  readonly shiftId: string;
  readonly shopId: string;
  readonly expectedVersion: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly plannedBreakMinutes: number;
  readonly commandId: string;
};

export type CancelShiftInput = {
  readonly shiftId: string;
  readonly shopId: string;
  readonly expectedVersion: number;
  readonly commandId: string;
};

export type CopyPreviousWeekInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly targetWeekStart: string;
  readonly commandId: string;
};

export type CorrectAttendanceInput = {
  readonly attendanceEventId: string;
  readonly shopId: string;
  readonly correctedOccurredAt: string;
  readonly reason: string;
  readonly commandId: string;
};

export type CreateLeaveRequestInput = {
  readonly employeeId: string;
  readonly shopId: string | null;
  readonly leaveType: StaffLeaveType;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly note: string | null;
  readonly commandId: string;
};

export type DecideLeaveRequestInput = {
  readonly leaveRequestId: string;
  readonly shopId: string;
  readonly expectedVersion: number;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string | null;
  readonly commandId: string;
};

export type RecordStaffPaymentInput = {
  readonly employeeId: string;
  readonly shopId: string;
  readonly payPeriodStart: string;
  readonly payPeriodEnd: string;
  readonly expectedAmountMinor: number;
  readonly paidAmountMinor: number;
  readonly financeAccountId: string;
  readonly paymentDate: string;
  readonly note: string | null;
  readonly reference: string | null;
  readonly commandId: string;
};
