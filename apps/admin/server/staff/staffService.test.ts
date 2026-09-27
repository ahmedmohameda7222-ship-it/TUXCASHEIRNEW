import type { AdminSessionPrincipal, RecordStaffPaymentInput } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createStaffService, type StaffStore } from './staffService';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';

function principal(permissions: AdminSessionPrincipal['permissions']): AdminSessionPrincipal {
  return {
    employeeId: ACTOR_ID,
    businessId: '55555555-5555-4555-8555-555555555555',
    role: 'MANAGER',
    permissions,
    shopIds: [SHOP_ID],
  };
}

function storeFixture(overrides: Partial<StaffStore> = {}): StaffStore {
  const ok = () => ({ ok: true as const, replayed: false });
  return {
    loadWorkspace: vi.fn<StaffStore['loadWorkspace']>(async () => ({
      employees: { rows: [], nextCursor: null },
      financeAccounts: [],
      workers: [],
    })),
    loadEmployeeDetail: async () => null,
    createEmployee: async () => ok(),
    updateEmployeeProfile: async () => ok(),
    assignEmployeeShop: async () => ok(),
    linkEmployeeWorker: async () => ok(),
    setEmployeeRole: async () => ok(),
    setEmployeePermission: async () => ok(),
    suspendEmployee: async () => ok(),
    reactivateEmployee: async () => ok(),
    setCompensation: async () => ok(),
    createShift: async () => ok(),
    updateShift: async () => ok(),
    cancelShift: async () => ok(),
    copyPreviousWeek: async () => ok(),
    createLeave: async () => ok(),
    decideLeave: async () => ok(),
    correctAttendance: vi.fn<StaffStore['correctAttendance']>(async () => ({
      ok: true as const,
      correctionId: '66666666-6666-4666-8666-666666666666',
      replayed: false,
    })),
    recordPayment: vi.fn<StaffStore['recordPayment']>(async () => ({
      ok: true as const,
      staffPaymentRecordId: '77777777-7777-4777-8777-777777777777',
      financeMovementId: '88888888-8888-4888-8888-888888888888',
      replayed: false,
    })),
    ...overrides,
  };
}

describe('staffService', () => {
  it('scopes staff reads through staff.view and the active shop', async () => {
    const loadWorkspace = vi.fn<StaffStore['loadWorkspace']>(async () => ({
      employees: { rows: [], nextCursor: null },
      financeAccounts: [],
      workers: [],
    }));
    const service = createStaffService(storeFixture({ loadWorkspace }));

    await service.loadWorkspace(SHOP_ID, principal(['staff.view']));

    expect(loadWorkspace).toHaveBeenCalledWith(SHOP_ID, '55555555-5555-4555-8555-555555555555');
  });

  it('does not expose payment accounts to staff.view without staff.payments', async () => {
    const loadWorkspace = vi.fn<StaffStore['loadWorkspace']>(async () => ({
      employees: { rows: [], nextCursor: null },
      financeAccounts: [
        {
          id: ACCOUNT_ID,
          shopId: SHOP_ID,
          accountType: 'CASH',
          name: 'Payroll Cash',
        },
      ],
      workers: [],
    }));
    const service = createStaffService(storeFixture({ loadWorkspace }));

    const result = await service.loadWorkspace(SHOP_ID, principal(['staff.view']));

    expect(result.financeAccounts).toEqual([]);
  });

  it('redacts compensation and payment history from view-only employee detail', async () => {
    const loadEmployeeDetail = vi.fn<StaffStore['loadEmployeeDetail']>(async () => ({
      id: EMPLOYEE_ID,
      businessId: '55555555-5555-4555-8555-555555555555',
      displayName: 'Mona',
      phone: null,
      hireDate: null,
      notes: null,
      role: 'STAFF',
      active: true,
      profileVersion: 1,
      credentialVersion: 1,
      customPermissions: [],
      assignments: [{ shopId: SHOP_ID, assigned: true }],
      operationsIdentities: [{ kind: 'SETUP_REQUIRED', shopId: SHOP_ID }],
      compensation: [
        {
          id: '99999999-9999-4999-8999-999999999991',
          employeeId: EMPLOYEE_ID,
          compensationType: 'MONTHLY',
          rateMinor: 300000,
          effectiveFrom: '2026-09-01',
          version: 1,
          createdAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      shifts: [],
      attendanceEvents: [],
      attendanceCorrections: [],
      attendanceSummaries: [],
      leaveRequests: [],
      payments: [
        {
          id: '99999999-9999-4999-8999-999999999992',
          employeeId: EMPLOYEE_ID,
          shopId: SHOP_ID,
          payPeriodStart: '2026-09-01',
          payPeriodEnd: '2026-09-30',
          expectedAmountMinor: 300000,
          paidAmountMinor: 300000,
          financeAccountId: ACCOUNT_ID,
          financeMovementId: '99999999-9999-4999-8999-999999999993',
          paymentDate: '2026-09-30',
          note: null,
          reference: null,
          actorEmployeeId: ACTOR_ID,
          createdAt: '2026-09-30T00:00:00.000Z',
        },
      ],
    }));
    const service = createStaffService(storeFixture({ loadEmployeeDetail }));

    const detail = await service.loadEmployeeDetail(
      { employeeId: EMPLOYEE_ID, shopId: SHOP_ID },
      principal(['staff.view']),
    );

    expect(detail?.compensation).toEqual([]);
    expect(detail?.payments).toEqual([]);
  });

  it('records an attendance correction without exposing an original-event update path', async () => {
    const store = storeFixture();
    const service = createStaffService(store);

    const result = await service.correctAttendance(
      {
        attendanceEventId: '99999999-9999-4999-8999-999999999999',
        shopId: SHOP_ID,
        correctedOccurredAt: '2026-09-10T06:00:00.000Z',
        reason: 'Forgot to clock in',
        commandId: 'attendance-correction-1',
      },
      principal(['staff.manage']),
    );

    expect(result.ok).toBe(true);
    expect(store.correctAttendance).toHaveBeenCalledWith({
      attendanceEventId: '99999999-9999-4999-8999-999999999999',
      shopId: SHOP_ID,
      correctedOccurredAt: '2026-09-10T06:00:00.000Z',
      reason: 'Forgot to clock in',
      commandId: 'attendance-correction-1',
      actorEmployeeId: ACTOR_ID,
    });
    expect(store).not.toHaveProperty('updateOriginalAttendanceEvent');
  });

  it('delegates one staff-payment command to the atomic payment RPC boundary', async () => {
    const recordPayment = vi.fn<StaffStore['recordPayment']>(async () => ({
      ok: true as const,
      staffPaymentRecordId: '77777777-7777-4777-8777-777777777777',
      financeMovementId: '88888888-8888-4888-8888-888888888888',
      replayed: false,
    }));
    const service = createStaffService(storeFixture({ recordPayment }));
    const input: RecordStaffPaymentInput = {
      employeeId: EMPLOYEE_ID,
      shopId: SHOP_ID,
      payPeriodStart: '2026-09-01',
      payPeriodEnd: '2026-09-30',
      expectedAmountMinor: 120000,
      paidAmountMinor: 120000,
      financeAccountId: ACCOUNT_ID,
      paymentDate: '2026-10-01',
      note: 'September salary',
      reference: 'PAY-SEP',
      commandId: 'staff-payment-1',
    };

    await service.recordPayment(input, principal(['staff.payments']));

    expect(recordPayment).toHaveBeenCalledTimes(1);
    expect(recordPayment).toHaveBeenCalledWith({
      ...input,
      actorEmployeeId: ACTOR_ID,
    });
  });

  it('fails closed when the acting principal lacks the domain permission', async () => {
    const store = storeFixture();
    const service = createStaffService(store);

    await expect(
      service.correctAttendance(
        {
          attendanceEventId: '99999999-9999-4999-8999-999999999999',
          shopId: SHOP_ID,
          correctedOccurredAt: '2026-09-10T06:00:00.000Z',
          reason: 'Forgot to clock in',
          commandId: 'attendance-correction-2',
        },
        principal([]),
      ),
    ).rejects.toMatchObject({ code: 'permission_forbidden' });

    expect(store.correctAttendance).not.toHaveBeenCalled();
  });
});
