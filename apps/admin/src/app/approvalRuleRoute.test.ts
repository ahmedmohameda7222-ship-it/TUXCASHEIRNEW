import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { routeIsPermitted } from './routes';

const base: AdminSessionPrincipal = {
  employeeId: 'employee-1',
  businessId: 'business-1',
  role: 'MANAGER',
  shopIds: ['c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46'],
  permissions: [],
};

describe('approval rule management route', () => {
  it('requires settings.manage without granting approval decision privileges', () => {
    expect(
      routeIsPermitted({ ...base, permissions: ['settings.manage'] }, '/approvals/rules'),
    ).toBe(true);
    expect(
      routeIsPermitted({ ...base, permissions: ['approvals.review'] }, '/approvals/rules'),
    ).toBe(false);
    expect(
      routeIsPermitted({ ...base, permissions: ['settings.manage'] }, '/approvals'),
    ).toBe(false);
  });
});
