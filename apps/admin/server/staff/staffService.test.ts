import type { AdminSessionPrincipal, RecordStaffPaymentInput } from '@tux/admin-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createStaffService, type StaffStore } from './staffService';

const SHOP_ID = '11111111-1111-4111-8111-111111111111';
const EMPLOYEE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const ATTENDANCE_EVENT_ID = '99999999-9999-4999-8999-999999999999';

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
    reactivateEmployeeWorker: async () => ok(),
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

function paymentInput(commandId: string): RecordStaffPaymentInput {
  return {
    employeeId: EMPLOYEE_ID,
    shopId: SHOP_ID,
    payPeriodStart: '2026-09-01',
    payPeriodEnd: '2026-09-30',
    expectedAmountMinor: 100_000,
    paidAmountMinor: 100_000,
    financeAccountId: ACCOUNT_ID,
    paymentDate: '2026-09-30',
    note: null,
    reference: null,
    commandId,
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
    expect(loadWorkspace).toHaveBeenCalledWith(
      SHOP_ID,
      '55555555-5555-4555-8555-555555555555',
      [SHOP_ID],
    );
  });

  it('rejects staff reads without staff.view', async () => {
    const service = createStaffService(storeFixture());
    await expect(service.loadWorkspace(SHOP_ID, principal([]))).rejects.toThrow('Forbidden');
  });

  it('requires staff.manage for compensation writes', async () => {
    const service = createStaffService(storeFixture());
    await expect(
      service.setCompensation(
        {
          employeeId: EMPLOYEE_ID,
          shopId: SHOP_ID,
          compensationType: 'MONTHLY',
          rateMinor: 100_000,
          effectiveFrom: '2026-09-01',
          commandId: 'comp-1',
        },
        principal(['staff.view']),
      ),
    ).rejects.toThrow('Forbidden');
  });

  it('requires staff.manage for attendance corrections', async () => {
    const service = createStaffService(storeFixture());
    await expect(
      service.correctAttendance(
        {
          attendanceEventId: ATTENDANCE_EVENT_ID,
          shopId: SHOP_ID,
          correctedOccurredAt: '2026-09-01T08:00:00.000Z',
          reason: 'Correction',
          commandId: 'attendance-1',
        },
        principal(['staff.view']),
      ),
    ).rejects.toThrow('Forbidden');
  });

  it('requires staff.payments for payroll writes', async () => {
    const recordPayment = vi.fn<StaffStore['recordPayment']>(async () => ({
      ok: true as const,
      staffPaymentRecordId: '77777777-7777-4777-8777-777777777777',
      financeMovementId: '88888888-8888-4888-8888-888888888888',
      replayed: false,
    }));
    const service = createStaffService(storeFixture({ recordPayment }));
    const input = paymentInput('pay-1');

    await expect(service.recordPayment(input, principal(['staff.view']))).rejects.toThrow(
      'Forbidden',
    );
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('passes the authenticated business and visible shops to payroll writes', async () => {
    const recordPayment = vi.fn<StaffStore['recordPayment']>(async () => ({
      ok: true as const,
      staffPaymentRecordId: '77777777-7777-4777-8777-777777777777',
      financeMovementId: '88888888-8888-4888-8888-888888888888',
      replayed: false,
    }));
    const service = createStaffService(storeFixture({ recordPayment }));
    const input = paymentInput('pay-2');

    await service.recordPayment(input, principal(['staff.payments']));
    expect(recordPayment).toHaveBeenCalledWith({
      ...input,
      businessId: '55555555-5555-4555-8555-555555555555',
      actorEmployeeId: ACTOR_ID,
      visibleShopIds: [SHOP_ID],
    });
  });
});
