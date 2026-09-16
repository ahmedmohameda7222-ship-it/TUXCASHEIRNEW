import { describe, expect, it, vi } from 'vitest';

import { appendAuditEvent } from './auditService';

describe('auditService credential safety', () => {
  it('rejects camelCase PIN material before calling persistence', async () => {
    const append = vi.fn(async () => 'audit-1');

    await expect(
      appendAuditEvent(
        {
          businessId: 'business-1',
          shopId: null,
          actorEmployeeId: 'employee-1',
          actionType: 'EMPLOYEE_PIN_CHANGED',
          entityType: 'EMPLOYEE',
          entityId: 'employee-2',
          beforeValue: null,
          afterValue: { newPin: '482731' },
          reason: 'rotation',
          approvalRequestId: null,
          sessionId: 'session-1',
          contextMetadata: {},
        },
        { append },
      ),
    ).rejects.toThrowError('admin_audit_credential_material_forbidden');

    expect(append).not.toHaveBeenCalled();
  });
});
