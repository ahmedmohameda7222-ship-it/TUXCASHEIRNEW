import { describe, expect, it } from 'vitest';

import { ADMIN_PERMISSIONS, ADMIN_ROLES, isAdminPermission, isAdminRole } from './auth';

describe('Admin auth contracts', () => {
  it('accepts only human Admin roles', () => {
    expect(ADMIN_ROLES).toEqual(['OWNER', 'ADMIN', 'MANAGER', 'STAFF']);
    expect(isAdminRole('OWNER')).toBe(true);
    expect(isAdminRole('OPERATIONS_DEVICE')).toBe(false);
  });

  it('publishes the reviewed stable permission taxonomy', () => {
    expect(ADMIN_PERMISSIONS).toEqual([
      'orders.view',
      'orders.manage',
      'orders.cancel',
      'orders.refund',
      'catalog.view',
      'catalog.edit',
      'catalog.pricing',
      'catalog.publish',
      'inventory.view',
      'inventory.adjust',
      'inventory.stocktake',
      'inventory.transfer',
      'inventory.override_negative',
      'purchasing.view',
      'purchasing.manage',
      'purchasing.receive',
      'customers.view',
      'customers.manage',
      'customers.merge',
      'loyalty.manage',
      'promotions.manage',
      'staff.view',
      'staff.manage',
      'staff.payments',
      'delivery.view',
      'delivery.manage',
      'finance.view',
      'finance.adjust',
      'finance.reconcile',
      'finance.manage_accounts',
      'reports.view',
      'alerts.view',
      'shops.manage',
      'devices.view',
      'devices.manage',
      'settings.manage',
      'whatsapp.view',
      'whatsapp.manage',
      'audit.view',
      'approvals.review',
    ]);
  });

  it('rejects arbitrary permission strings at the contract boundary', () => {
    expect(isAdminPermission('catalog.publish')).toBe(true);
    expect(isAdminPermission('catalog.do_anything')).toBe(false);
  });
});
