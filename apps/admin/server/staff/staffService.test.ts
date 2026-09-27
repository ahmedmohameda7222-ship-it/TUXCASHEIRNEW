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
    loadWorkspace: vi.fn(async () => ({
      employees: { rows: [], nextCursor: null },
      financeAccounts: [],
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
    correctAttendance: vi.fn(async () => ({
      ok: true as const,
      correctionId: '66666666-6666-4666-8666-666666666666',
      replayed: false,
    })),
    recordPayment: vi.fn(async () => ({
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
    const loadWorkspace = vi.fn(async () => ({
      employees: { rows: [], nextCursor: null },
      financeAccounts: [],
    }));
    const service = createStaffService(storeFixture({ loadWorkspace }));

    await service.loadWorkspace(SHOP_ID, principal(['staff.view']));

    expect(loadWorkspace).toHaveBeenCalledWith(
      SHOP_ID,
      '55555555-5555-4555-8555-555555555555',
    );
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
    const recordPayment = vi.fn(async () => ({
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
