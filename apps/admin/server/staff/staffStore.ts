import type {
  AdminPermission,
  AdminRole,
  AttendanceCorrection,
  AttendanceEvent,
  CreateEmployeeInput,
  CreateLeaveRequestInput,
  CreateShiftInput,
  DecideLeaveRequestInput,
  EmployeeCompensation,
  EmployeeDetail,
  EmployeeShift,
  EmployeeSummary,
  LeaveRequest,
  LinkedOperationsIdentityState,
  RecordStaffPaymentInput,
  SetCompensationInput,
  SetEmployeeRoleInput,
  StaffCommandResult,
  StaffFinanceAccountChoice,
  StaffListResult,
  StaffPaymentRecord,
  StaffWorkspace,
  UpdateEmployeeProfileInput,
  UpdateShiftInput,
  CancelShiftInput,
  CopyPreviousWeekInput,
  CorrectAttendanceInput,
  AssignEmployeeShopInput,
  LinkEmployeeWorkerInput,
  SuspendEmployeeInput,
} from '@tux/admin-contracts';

import { isAdminPermission, isAdminRole } from '../adminContractRuntime.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

type EmployeeRow = {
  id: string;
  business_id: string;
  display_name: string;
  phone: string | null;
  hire_date: string | null;
  notes: string | null;
  role: string;
  active: boolean;
  profile_version: number | string;
  credential_version: number | string;
};

type AssignmentRow = {
  employee_id: string;
  shop_id: string;
};

type WorkerLinkRow = {
  employee_id: string;
  shop_id: string;
  worker_id: string;
  active: boolean;
};

type WorkerRow = {
  id: string;
  shop_id: string;
  display_name: string;
  active: boolean;
  credential_version: number | string;
};

type PermissionRow = {
  permission_key: string;
  effect: 'ALLOW' | 'DENY';
};

type CompensationRow = {
  id: string;
  employee_id: string;
  compensation_type: EmployeeCompensation['compensationType'];
  rate_minor: number | string;
  effective_from: string;
  version: number | string;
  created_at: string;
};

type ShiftRow = {
  id: string;
  employee_id: string;
  shop_id: string;
  starts_at: string;
  ends_at: string;
  planned_break_minutes: number | string;
  status: EmployeeShift['status'];
  version: number | string;
  source_shift_id: string | null;
  created_at: string;
  updated_at: string;
};

type AttendanceEventRow = {
  id: string;
  employee_id: string;
  shop_id: string;
  worker_id: string;
  worker_session_id: string;
  event_type: AttendanceEvent['eventType'];
  occurred_at: string;
  created_at: string;
};

type AttendanceCorrectionRow = {
  id: string;
  employee_id: string;
  shop_id: string;
  attendance_event_id: string;
  original_occurred_at: string;
  corrected_occurred_at: string;
  reason: string;
  corrected_by_employee_id: string;
  created_at: string;
};

type LeaveRow = {
  id: string;
  employee_id: string;
  shop_id: string | null;
  leave_type: LeaveRequest['leaveType'];
  starts_on: string;
  ends_on: string;
  note: string | null;
  status: LeaveRequest['status'];
  requester_employee_id: string;
  decided_by_employee_id: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  version: number | string;
  created_at: string;
  updated_at: string;
};

type PaymentRow = {
  id: string;
  employee_id: string;
  shop_id: string;
  pay_period_start: string;
  pay_period_end: string;
  expected_amount_minor: number | string;
  paid_amount_minor: number | string;
  finance_account_id: string;
  finance_movement_id: string;
  payment_date: string;
  note: string | null;
  reference: string | null;
  actor_employee_id: string;
  created_at: string;
};

type FinanceAccountRow = {
  id: string;
  shop_id: string | null;
  account_type: StaffFinanceAccountChoice['accountType'];
  name: string;
};

function safeInteger(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('staff_backend_contract_invalid');
  return result;
}

function requireRole(value: string): AdminRole {
  if (!isAdminRole(value)) throw new Error('staff_backend_contract_invalid');
  return value;
}

function inFilter(ids: readonly string[]): string {
  return `in.(${ids.join(',')})`;
}

function mapCompensation(row: CompensationRow): EmployeeCompensation {
  return {
    id: row.id,
    employeeId: row.employee_id,
    compensationType: row.compensation_type,
    rateMinor: safeInteger(row.rate_minor),
    effectiveFrom: row.effective_from,
    version: safeInteger(row.version),
    createdAt: row.created_at,
  };
}

function mapShift(row: ShiftRow): EmployeeShift {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shopId: row.shop_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    plannedBreakMinutes: safeInteger(row.planned_break_minutes),
    status: row.status,
    version: safeInteger(row.version),
    sourceShiftId: row.source_shift_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAttendanceEvent(row: AttendanceEventRow): AttendanceEvent {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shopId: row.shop_id,
    workerId: row.worker_id,
    workerSessionId: row.worker_session_id,
    eventType: row.event_type,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}

function mapAttendanceCorrection(row: AttendanceCorrectionRow): AttendanceCorrection {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shopId: row.shop_id,
    attendanceEventId: row.attendance_event_id,
    originalOccurredAt: row.original_occurred_at,
    correctedOccurredAt: row.corrected_occurred_at,
    reason: row.reason,
    correctedByEmployeeId: row.corrected_by_employee_id,
    createdAt: row.created_at,
  };
}

function mapLeave(row: LeaveRow): LeaveRequest {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shopId: row.shop_id,
    leaveType: row.leave_type,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    note: row.note,
    status: row.status,
    requesterEmployeeId: row.requester_employee_id,
    decidedByEmployeeId: row.decided_by_employee_id,
    decisionReason: row.decision_reason,
    decidedAt: row.decided_at,
    version: safeInteger(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPayment(row: PaymentRow): StaffPaymentRecord {
  return {
    id: row.id,
    employeeId: row.employee_id,
    shopId: row.shop_id,
    payPeriodStart: row.pay_period_start,
    payPeriodEnd: row.pay_period_end,
    expectedAmountMinor: safeInteger(row.expected_amount_minor),
    paidAmountMinor: safeInteger(row.paid_amount_minor),
    financeAccountId: row.finance_account_id,
    financeMovementId: row.finance_movement_id,
    paymentDate: row.payment_date,
    note: row.note,
    reference: row.reference,
    actorEmployeeId: row.actor_employee_id,
    createdAt: row.created_at,
  };
}

export interface StaffStore {
  loadWorkspace(shopId: string, businessId: string): Promise<StaffWorkspace>;
  loadEmployeeDetail(input: {
    employeeId: string;
    shopId: string;
    businessId: string;
  }): Promise<EmployeeDetail | null>;
  createEmployee(input: CreateEmployeeInput & { actorEmployeeId: string }): Promise<StaffCommandResult>;
  updateEmployeeProfile(
    input: UpdateEmployeeProfileInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  assignEmployeeShop(
    input: AssignEmployeeShopInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  linkEmployeeWorker(
    input: LinkEmployeeWorkerInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  setEmployeeRole(
    input: SetEmployeeRoleInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  setEmployeePermission(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    permissionKey: AdminPermission;
    effect: 'ALLOW' | 'DENY';
    commandId: string;
  }): Promise<StaffCommandResult>;
  suspendEmployee(
    input: SuspendEmployeeInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  reactivateEmployee(input: {
    actorEmployeeId: string;
    employeeId: string;
    shopId: string;
    expectedVersion: number;
    commandId: string;
  }): Promise<StaffCommandResult>;
  setCompensation(
    input: SetCompensationInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  createShift(input: CreateShiftInput & { actorEmployeeId: string }): Promise<StaffCommandResult>;
  updateShift(input: UpdateShiftInput & { actorEmployeeId: string }): Promise<StaffCommandResult>;
  cancelShift(input: CancelShiftInput & { actorEmployeeId: string }): Promise<StaffCommandResult>;
  copyPreviousWeek(
    input: CopyPreviousWeekInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  createLeave(
    input: CreateLeaveRequestInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  decideLeave(
    input: DecideLeaveRequestInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  correctAttendance(
    input: CorrectAttendanceInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
  recordPayment(
    input: RecordStaffPaymentInput & { actorEmployeeId: string },
  ): Promise<StaffCommandResult>;
}

export function createSupabaseStaffStore(client: AdminSupabaseClient): StaffStore {
  return {
    async loadWorkspace(shopId, businessId): Promise<StaffWorkspace> {
      const shopAssignments = await client.select<AssignmentRow[]>(
        'employee_shop_assignments',
        new URLSearchParams({
          select: 'employee_id,shop_id',
          business_id: `eq.${businessId}`,
          shop_id: `eq.${shopId}`,
          order: 'employee_id.asc',
        }),
      );
      const employeeIds = [...new Set(shopAssignments.map((row) => row.employee_id))];
      let employees: EmployeeRow[] = [];
      let allAssignments: AssignmentRow[] = [];
      let links: WorkerLinkRow[] = [];

      if (employeeIds.length > 0) {
        [employees, allAssignments, links] = await Promise.all([
          client.select<EmployeeRow[]>(
            'business_employees',
            new URLSearchParams({
              select:
                'id,business_id,display_name,phone,hire_date,notes,role,active,profile_version,credential_version',
              business_id: `eq.${businessId}`,
              id: inFilter(employeeIds),
              order: 'display_name.asc,id.asc',
            }),
          ),
          client.select<AssignmentRow[]>(
            'employee_shop_assignments',
            new URLSearchParams({
              select: 'employee_id,shop_id',
              business_id: `eq.${businessId}`,
              employee_id: inFilter(employeeIds),
              order: 'employee_id.asc,shop_id.asc',
            }),
          ),
          client.select<WorkerLinkRow[]>(
            'employee_worker_links',
            new URLSearchParams({
              select: 'employee_id,shop_id,worker_id,active',
              business_id: `eq.${businessId}`,
              employee_id: inFilter(employeeIds),
              active: 'eq.true',
            }),
          ),
        ]);
      }

      const shopIdsByEmployee = new Map<string, string[]>();
      for (const assignment of allAssignments) {
        const ids = shopIdsByEmployee.get(assignment.employee_id) ?? [];
        ids.push(assignment.shop_id);
        shopIdsByEmployee.set(assignment.employee_id, ids);
      }
      const linkedKeys = new Set(
        links.map((link) => `${link.employee_id}:${link.shop_id}`),
      );

      const rows: EmployeeSummary[] = employees.map((employee) => {
        const shopIds = shopIdsByEmployee.get(employee.id) ?? [];
        return {
          id: employee.id,
          displayName: employee.display_name,
          phone: employee.phone,
          role: requireRole(employee.role),
          active: employee.active,
          shopIds,
          operationsSetupRequiredShopIds: shopIds.filter(
            (assignedShopId) => !linkedKeys.has(`${employee.id}:${assignedShopId}`),
          ),
        };
      });

      const financeAccounts = await client.select<FinanceAccountRow[]>(
        'finance_accounts',
        new URLSearchParams({
          select: 'id,shop_id,account_type,name',
          business_id: `eq.${businessId}`,
          active: 'eq.true',
          or: `(shop_id.eq.${shopId},shop_id.is.null)`,
          order: 'name.asc,id.asc',
        }),
      );

      const employeesResult: StaffListResult = { rows, nextCursor: null };
      return {
        employees: employeesResult,
        financeAccounts: financeAccounts.map((account) => ({
          id: account.id,
          shopId: account.shop_id,
          accountType: account.account_type,
          name: account.name,
        })),
      };
    },

    async loadEmployeeDetail({ employeeId, shopId, businessId }) {
      const employees = await client.select<EmployeeRow[]>(
        'business_employees',
        new URLSearchParams({
          select:
            'id,business_id,display_name,phone,hire_date,notes,role,active,profile_version,credential_version',
          business_id: `eq.${businessId}`,
          id: `eq.${employeeId}`,
          limit: '1',
        }),
      );
      const employee = employees[0];
      if (!employee) return null;

      const requiredAssignment = await client.select<AssignmentRow[]>(
        'employee_shop_assignments',
        new URLSearchParams({
          select: 'employee_id,shop_id',
          business_id: `eq.${businessId}`,
          employee_id: `eq.${employeeId}`,
          shop_id: `eq.${shopId}`,
          limit: '1',
        }),
      );
      if (!requiredAssignment[0]) return null;

      const [
        assignments,
        links,
        permissionRows,
        compensationRows,
        shifts,
        attendanceEvents,
        attendanceCorrections,
        leaveRows,
        paymentRows,
      ] = await Promise.all([
        client.select<AssignmentRow[]>(
          'employee_shop_assignments',
          new URLSearchParams({
            select: 'employee_id,shop_id',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'shop_id.asc',
          }),
        ),
        client.select<WorkerLinkRow[]>(
          'employee_worker_links',
          new URLSearchParams({
            select: 'employee_id,shop_id,worker_id,active',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            active: 'eq.true',
          }),
        ),
        client.select<PermissionRow[]>(
          'admin_employee_permissions',
          new URLSearchParams({
            select: 'permission_key,effect',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
          }),
        ),
        client.select<CompensationRow[]>(
          'employee_compensation',
          new URLSearchParams({
            select: 'id,employee_id,compensation_type,rate_minor,effective_from,version,created_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'effective_from.desc,version.desc',
          }),
        ),
        client.select<ShiftRow[]>(
          'employee_shifts',
          new URLSearchParams({
            select:
              'id,employee_id,shop_id,starts_at,ends_at,planned_break_minutes,status,version,source_shift_id,created_at,updated_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'starts_at.desc,id.desc',
            limit: '500',
          }),
        ),
        client.select<AttendanceEventRow[]>(
          'attendance_events',
          new URLSearchParams({
            select:
              'id,employee_id,shop_id,worker_id,worker_session_id,event_type,occurred_at,created_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'occurred_at.desc,id.desc',
            limit: '1000',
          }),
        ),
        client.select<AttendanceCorrectionRow[]>(
          'attendance_corrections',
          new URLSearchParams({
            select:
              'id,employee_id,shop_id,attendance_event_id,original_occurred_at,corrected_occurred_at,reason,corrected_by_employee_id,created_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'created_at.desc,id.desc',
            limit: '1000',
          }),
        ),
        client.select<LeaveRow[]>(
          'leave_requests',
          new URLSearchParams({
            select:
              'id,employee_id,shop_id,leave_type,starts_on,ends_on,note,status,requester_employee_id,decided_by_employee_id,decision_reason,decided_at,version,created_at,updated_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'starts_on.desc,id.desc',
            limit: '500',
          }),
        ),
        client.select<PaymentRow[]>(
          'staff_payment_records',
          new URLSearchParams({
            select:
              'id,employee_id,shop_id,pay_period_start,pay_period_end,expected_amount_minor,paid_amount_minor,finance_account_id,finance_movement_id,payment_date,note,reference,actor_employee_id,created_at',
            business_id: `eq.${businessId}`,
            employee_id: `eq.${employeeId}`,
            order: 'payment_date.desc,id.desc',
            limit: '500',
          }),
        ),
      ]);

      const workerIds = links.map((link) => link.worker_id);
      const workers =
        workerIds.length === 0
          ? []
          : await client.select<WorkerRow[]>(
              'workers',
              new URLSearchParams({
                select: 'id,shop_id,display_name,active,credential_version',
                id: inFilter(workerIds),
              }),
            );
      const workersById = new Map(workers.map((worker) => [worker.id, worker]));
      const linkByShop = new Map(links.map((link) => [link.shop_id, link]));

      const operationsIdentities: LinkedOperationsIdentityState[] = assignments.map((assignment) => {
        const link = linkByShop.get(assignment.shop_id);
        const worker = link ? workersById.get(link.worker_id) : undefined;
        if (!link || !worker) {
          return { kind: 'SETUP_REQUIRED', shopId: assignment.shop_id };
        }
        return {
          kind: 'LINKED',
          shopId: assignment.shop_id,
          workerId: worker.id,
          workerName: worker.display_name,
          workerActive: worker.active,
          credentialVersion: safeInteger(worker.credential_version),
        };
      });

      const customPermissions = permissionRows
        .filter((row) => row.effect === 'ALLOW' && isAdminPermission(row.permission_key))
        .map((row) => row.permission_key as AdminPermission);

      return {
        id: employee.id,
        businessId: employee.business_id,
        displayName: employee.display_name,
        phone: employee.phone,
        hireDate: employee.hire_date,
        notes: employee.notes,
        role: requireRole(employee.role),
        active: employee.active,
        profileVersion: safeInteger(employee.profile_version),
        credentialVersion: safeInteger(employee.credential_version),
        customPermissions,
        assignments: assignments.map((assignment) => ({
          shopId: assignment.shop_id,
          assigned: true,
        })),
        operationsIdentities,
        compensation: compensationRows.map(mapCompensation),
        shifts: shifts.map(mapShift),
        attendanceEvents: attendanceEvents.map(mapAttendanceEvent),
        attendanceCorrections: attendanceCorrections.map(mapAttendanceCorrection),
        leaveRequests: leaveRows.map(mapLeave),
        payments: paymentRows.map(mapPayment),
      };
    },

    createEmployee(input) {
      return client.rpc<StaffCommandResult>('create_employee_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_shop_id: input.shopId,
        p_display_name: input.displayName,
        p_phone: input.phone,
        p_hire_date: input.hireDate,
        p_notes: input.notes,
        p_role: input.role,
        p_command_id: input.commandId,
      });
    },

    updateEmployeeProfile(input) {
      return client.rpc<StaffCommandResult>('update_employee_profile_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_expected_profile_version: input.expectedVersion,
        p_display_name: input.displayName,
        p_phone: input.phone,
        p_hire_date: input.hireDate,
        p_notes: input.notes,
        p_command_id: input.commandId,
      });
    },

    assignEmployeeShop(input) {
      return client.rpc<StaffCommandResult>('assign_employee_to_shop_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_command_id: input.commandId,
      });
    },

    linkEmployeeWorker(input) {
      return client.rpc<StaffCommandResult>('link_employee_worker_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_worker_id: input.workerId,
        p_command_id: input.commandId,
      });
    },

    setEmployeeRole(input) {
      return client.rpc<StaffCommandResult>('set_employee_role_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_expected_profile_version: input.expectedVersion,
        p_role: input.role,
        p_command_id: input.commandId,
      });
    },

    setEmployeePermission(input) {
      return client.rpc<StaffCommandResult>('set_employee_permission_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_expected_profile_version: input.expectedVersion,
        p_permission_key: input.permissionKey,
        p_effect: input.effect,
        p_command_id: input.commandId,
      });
    },

    suspendEmployee(input) {
      return client.rpc<StaffCommandResult>('suspend_employee_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_expected_profile_version: input.expectedVersion,
        p_command_id: input.commandId,
      });
    },

    reactivateEmployee(input) {
      return client.rpc<StaffCommandResult>('reactivate_employee_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_expected_profile_version: input.expectedVersion,
        p_shop_id: input.shopId,
        p_command_id: input.commandId,
      });
    },

    setCompensation(input) {
      return client.rpc<StaffCommandResult>('set_employee_compensation_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_compensation_type: input.compensationType,
        p_rate_minor: input.rateMinor,
        p_effective_from: input.effectiveFrom,
        p_command_id: input.commandId,
      });
    },

    createShift(input) {
      return client.rpc<StaffCommandResult>('create_employee_shift_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_planned_break_minutes: input.plannedBreakMinutes,
        p_command_id: input.commandId,
      });
    },

    updateShift(input) {
      return client.rpc<StaffCommandResult>('update_employee_shift_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_shift_id: input.shiftId,
        p_expected_version: input.expectedVersion,
        p_starts_at: input.startsAt,
        p_ends_at: input.endsAt,
        p_planned_break_minutes: input.plannedBreakMinutes,
        p_command_id: input.commandId,
      });
    },

    cancelShift(input) {
      return client.rpc<StaffCommandResult>('cancel_employee_shift_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_shift_id: input.shiftId,
        p_expected_version: input.expectedVersion,
        p_command_id: input.commandId,
      });
    },

    copyPreviousWeek(input) {
      return client.rpc<StaffCommandResult>('copy_previous_week_shifts_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_target_week_start: input.targetWeekStart,
        p_command_id: input.commandId,
      });
    },

    createLeave(input) {
      return client.rpc<StaffCommandResult>('create_leave_request_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_shop_id: input.shopId,
        p_leave_type: input.leaveType,
        p_starts_on: input.startsOn,
        p_ends_on: input.endsOn,
        p_note: input.note,
        p_command_id: input.commandId,
      });
    },

    decideLeave(input) {
      return client.rpc<StaffCommandResult>('decide_leave_request_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_leave_request_id: input.leaveRequestId,
        p_expected_version: input.expectedVersion,
        p_decision: input.decision,
        p_reason: input.reason,
        p_command_id: input.commandId,
      });
    },

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
