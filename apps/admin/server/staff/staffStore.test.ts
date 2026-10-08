import { describe, expect, it, vi } from 'vitest';

import type { AdminSupabaseClient } from '../supabaseAdmin';
import { createSupabaseStaffStore } from './staffStore';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const SHOP_ID = '22222222-2222-4222-8222-222222222222';
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333';
const WORKER_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_SHOP_ID = '99999999-9999-4999-8999-999999999999';

function employeeRow() {
  return {
    id: EMPLOYEE_ID,
    business_id: BUSINESS_ID,
    display_name: 'Mona Ali',
    phone: null,
    hire_date: null,
    notes: null,
    role: 'STAFF',
    active: true,
    profile_version: 1,
    credential_version: 1,
  };
}

describe('staffStore', () => {
  it('exposes only active finance accounts compatible with the current business/shop scope', async () => {
    const select = vi.fn(async (table: string, params: URLSearchParams) => {
      if (table === 'business_employees') return [employeeRow()];
      if (table === 'employee_shop_assignments')
        return [{ employee_id: EMPLOYEE_ID, shop_id: SHOP_ID }];
      if (table === 'employee_worker_links') return [];
      if (table === 'workers') return [];
      if (table === 'shops') {
        expect(params.get('business_id')).toBe(`eq.${BUSINESS_ID}`);
        return [{ id: SHOP_ID, name: 'Downtown' }];
      }
      if (table === 'finance_accounts') {
        expect(params.get('business_id')).toBe(`eq.${BUSINESS_ID}`);
        expect(params.get('active')).toBe('eq.true');
        return [{ id: WORKER_ID, shop_id: SHOP_ID, account_type: 'CASH', name: 'Payroll Cash' }];
      }
      throw new Error(`unexpected_table:${table}`);
    });
    const store = createSupabaseStaffStore({ select } as unknown as AdminSupabaseClient);
    const workspace = await store.loadWorkspace(SHOP_ID, BUSINESS_ID, [SHOP_ID]);
    expect(workspace.employees.rows[0]?.operationsSetupRequiredShopIds).toEqual([SHOP_ID]);
    expect(workspace.shops).toEqual([{ id: SHOP_ID, name: 'Downtown' }]);
  });

  it('marks a preserved inactive linked worker as Operations action required', async () => {
    const select = vi.fn(async (table: string) => {
      if (table === 'business_employees') return [employeeRow()];
      if (table === 'employee_shop_assignments')
        return [{ employee_id: EMPLOYEE_ID, shop_id: SHOP_ID }];
      if (table === 'employee_worker_links')
        return [{ employee_id: EMPLOYEE_ID, shop_id: SHOP_ID, worker_id: WORKER_ID }];
      if (table === 'workers')
        return [
          {
            id: WORKER_ID,
            shop_id: SHOP_ID,
            display_name: 'Mona Ops',
            active: false,
            credential_version: 5,
          },
        ];
      if (table === 'finance_accounts') return [];
      if (table === 'shops') return [{ id: SHOP_ID, name: 'Downtown' }];
      throw new Error(`unexpected_table:${table}`);
    });
    const store = createSupabaseStaffStore({ select } as unknown as AdminSupabaseClient);
    const workspace = await store.loadWorkspace(SHOP_ID, BUSINESS_ID, [SHOP_ID]);
    expect(workspace.employees.rows[0]?.operationsSetupRequiredShopIds).toEqual([SHOP_ID]);
  });

  it('does not read employee facts from shops outside the actor visible scope', async () => {
    const scopedTables = new Set([
      'employee_shifts',
      'attendance_events',
      'attendance_corrections',
      'staff_payment_records',
    ]);
    const select = vi.fn(async (table: string, params: URLSearchParams) => {
      if (table === 'business_employees') return [employeeRow()];
      if (table === 'employee_shop_assignments')
        return [{ employee_id: EMPLOYEE_ID, shop_id: SHOP_ID }];
      if (table === 'employee_worker_links') return [];
      if (scopedTables.has(table)) {
        expect(params.get('shop_id')).toBe(`in.(${SHOP_ID})`);
        return [];
      }
      if (table === 'leave_requests') return [];
      if (table === 'admin_employee_permissions' || table === 'employee_compensation') return [];
      throw new Error(`unexpected_table:${table}`);
    });
    const store = createSupabaseStaffStore({ select } as unknown as AdminSupabaseClient);
    const detail = await store.loadEmployeeDetail({
      employeeId: EMPLOYEE_ID,
      shopId: SHOP_ID,
      businessId: BUSINESS_ID,
      visibleShopIds: [SHOP_ID],
    });
    expect(detail?.assignments).toEqual([{ shopId: SHOP_ID, assigned: true }]);
    expect(JSON.stringify(detail)).not.toContain(OTHER_SHOP_ID);
  });

  it('preserves explicit ALLOW and DENY permission overrides in the employee read model', async () => {
    const select = vi.fn(async (table: string) => {
      if (table === 'business_employees') return [employeeRow()];
      if (table === 'employee_shop_assignments')
        return [{ employee_id: EMPLOYEE_ID, shop_id: SHOP_ID }];
      if (table === 'admin_employee_permissions')
        return [
          { permission_key: 'staff.manage', effect: 'ALLOW' },
          { permission_key: 'reports.view', effect: 'DENY' },
        ];
      if (
        [
          'employee_worker_links',
          'employee_compensation',
          'employee_shifts',
          'attendance_events',
          'attendance_corrections',
          'leave_requests',
          'staff_payment_records',
        ].includes(table)
      )
        return [];
      throw new Error(`unexpected_table:${table}`);
    });
    const store = createSupabaseStaffStore({ select } as unknown as AdminSupabaseClient);
    const detail = await store.loadEmployeeDetail({
      employeeId: EMPLOYEE_ID,
      shopId: SHOP_ID,
      businessId: BUSINESS_ID,
      visibleShopIds: [SHOP_ID],
    });
    expect(detail?.customPermissions).toEqual(['staff.manage']);
    expect(detail?.customDeniedPermissions).toEqual(['reports.view']);
  });
});
