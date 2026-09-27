import { describe, expect, it, vi } from 'vitest';

import type { AdminApprovalExecutionClaim } from '@tux/admin-contracts';

import {
  createApprovalCommandRegistry,
  serializeApprovalCommand,
} from '../approvals/approvalService';
import {
  EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
  createStaffApprovalCommandEntries,
  createStaffApprovalExecutionEntries,
} from './staffApproval';

const claim: AdminApprovalExecutionClaim = {
  approvalRequestId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  shopId: '33333333-3333-4333-8333-333333333333',
  requesterEmployeeId: '44444444-4444-4444-8444-444444444444',
  approverEmployeeId: '55555555-5555-4555-8555-555555555555',
  actionType: EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
  commandId: '66666666-6666-4666-8666-666666666666',
  commandPayload: {
    employeeId: '77777777-7777-4777-8777-777777777777',
    targetShopIds: ['33333333-3333-4333-8333-333333333333'],
    expectedCredentialVersion: 7,
    commandRef: '88888888-8888-4888-8888-888888888888',
  },
  claimToken: 'claim-token',
  attemptCount: 1,
  leaseExpiresAt: '2026-09-27T16:00:00.000Z',
};

describe('Workforce approval security', () => {
  it('serializes PIN approval using only opaque safe command metadata', () => {
    const registry = createApprovalCommandRegistry(createStaffApprovalCommandEntries());
    const sentinelPin = '482731';
    const verifierHash =
      'pbkdf2-sha256$210000$11111111111111111111111111111111$' + '2'.repeat(64);
    const lookupHash = '3'.repeat(64);

    expect(() =>
      serializeApprovalCommand(registry, EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION, {
        employeeId: claim.commandPayload.employeeId,
        targetShopIds: claim.commandPayload.targetShopIds,
        expectedCredentialVersion: 7,
        commandRef: claim.commandPayload.commandRef,
        newPin: sentinelPin,
        pinVerifierHash: verifierHash,
        pinLookupHash: lookupHash,
      }),
    ).toThrowError('approval_pin_payload_unsafe');

    const payload = serializeApprovalCommand(registry, EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION, {
      employeeId: claim.commandPayload.employeeId,
      targetShopIds: claim.commandPayload.targetShopIds,
      expectedCredentialVersion: 7,
      commandRef: claim.commandPayload.commandRef,
    });

    const persisted = JSON.stringify(payload);
    expect(payload).toEqual(claim.commandPayload);
    expect(persisted).not.toContain(sentinelPin);
    expect(persisted).not.toContain(verifierHash);
    expect(persisted).not.toContain(lookupHash);
    expect(persisted).not.toContain('salt');
  });

  it('executes approved PIN changes using only the opaque command reference', async () => {
    const applyEmployeePinChange = vi.fn(async () => ({
      ok: true as const,
      replayed: false,
      employeeId: String(claim.commandPayload.employeeId),
      credentialVersion: 8,
    }));
    const entries = createStaffApprovalExecutionEntries({
      applyEmployeePinChange,
      setEmployeeRole: vi.fn(),
      setEmployeePermission: vi.fn(),
      suspendEmployee: vi.fn(),
      recordStaffPayment: vi.fn(),
    });
    const entry = entries.find(
      (candidate) => candidate.actionType === EMPLOYEE_PIN_CHANGE_APPROVAL_ACTION,
    );
    expect(entry).toBeDefined();

    const result = await entry!.execute({
      commandId: claim.commandId,
      payload: claim.commandPayload,
      claim,
    });

    expect(applyEmployeePinChange).toHaveBeenCalledWith({
      actorEmployeeId: claim.requesterEmployeeId,
      employeeId: claim.commandPayload.employeeId,
      businessId: claim.businessId,
      targetShopIds: claim.commandPayload.targetShopIds,
      expectedCredentialVersion: 7,
      commandRef: claim.commandPayload.commandRef,
      approvalRequestId: claim.approvalRequestId,
    });
    expect(JSON.stringify(applyEmployeePinChange.mock.calls)).not.toContain('pinVerifierHash');
    expect(JSON.stringify(applyEmployeePinChange.mock.calls)).not.toContain('pinLookupHash');
    expect(result).toMatchObject({ idempotentReplay: false });
  });
});
