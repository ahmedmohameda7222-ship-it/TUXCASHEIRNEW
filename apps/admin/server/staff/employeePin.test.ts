import { describe, expect, it, vi } from 'vitest';

import { hashPin, verifyPin } from '../pin';
import {
  prepareEmployeePinChange,
  type EmployeePinStore,
  type WorkerCredentialCandidate,
} from './employeePin';

const BUSINESS_ID = '10000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '20000000-0000-4000-8000-000000000001';
const ACTOR_ID = '20000000-0000-4000-8000-000000000002';
const SHOP_A = '30000000-0000-4000-8000-000000000001';
const SHOP_B = '30000000-0000-4000-8000-000000000002';
const COMMAND_ID = '40000000-0000-4000-8000-000000000001';
const SECRET = 'test-pin-lookup-secret-with-entropy';
const CANONICAL_FINGERPRINT = 'f'.repeat(64);

function storeFixture(overrides: Partial<EmployeePinStore> = {}): EmployeePinStore {
  return {
    loadEmployeeCredentialState: vi.fn(async () => ({ businessId: BUSINESS_ID, employeeId: EMPLOYEE_ID, active: true, credentialVersion: 7 })),
    listAssignedShopIds: vi.fn(async () => [SHOP_B, SHOP_A]),
    hasEmployeeLookupCollision: vi.fn(async () => false),
    listPinCollisionWorkers: vi.fn(async () => []),
    loadWorkerStateFingerprint: vi.fn(async () => ({ ok: true as const, fingerprint: CANONICAL_FINGERPRINT })),
    stageCredentialCommand: vi.fn<EmployeePinStore['stageCredentialCommand']>(async () => ({ ok: true as const, commandRef: '50000000-0000-4000-8000-000000000001', expectedCredentialVersion: 7, replayed: false })),
    ...overrides,
  };
}

function request(pin = '482731') {
  return { actorEmployeeId: ACTOR_ID, businessId: BUSINESS_ID, employeeId: EMPLOYEE_ID, pin, lookupSecret: SECRET, commandId: COMMAND_ID, expiresAt: new Date('2026-09-27T12:00:00Z') };
}

describe('employee PIN coherence', () => {
  it('fails closed on invalid PIN format before staging anything', async () => {
    const store = storeFixture();
    expect(await prepareEmployeePinChange(request('12ab'), store)).toEqual({ ok: false, code: 'invalid_pin_format' });
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });

  it('rejects another active business employee lookup collision', async () => {
    const store = storeFixture({ hasEmployeeLookupCollision: vi.fn(async () => true) });
    expect(await prepareEmployeePinChange(request(), store)).toEqual({ ok: false, code: 'pin_already_in_use' });
    expect(store.listPinCollisionWorkers).not.toHaveBeenCalled();
  });

  it('checks active collision candidates but excludes the employee own linked worker', async () => {
    const workers: WorkerCredentialCandidate[] = [
      { id: '60000000-0000-4000-8000-000000000001', shopId: SHOP_A, pinHash: await hashPin('111111'), pinLookupHash: null, credentialVersion: 1, linkedEmployeeId: null },
      { id: '60000000-0000-4000-8000-000000000002', shopId: SHOP_B, pinHash: await hashPin('482731'), pinLookupHash: null, credentialVersion: 1, linkedEmployeeId: null },
      { id: '60000000-0000-4000-8000-000000000003', shopId: SHOP_B, pinHash: await hashPin('482731'), pinLookupHash: null, credentialVersion: 1, linkedEmployeeId: EMPLOYEE_ID },
    ];
    const store = storeFixture({ listPinCollisionWorkers: vi.fn(async () => workers) });
    expect(await prepareEmployeePinChange(request(), store)).toEqual({ ok: false, code: 'pin_already_in_use' });
    expect(store.loadWorkerStateFingerprint).not.toHaveBeenCalled();
  });

  it('stages one-way material using the PostgreSQL canonical worker-state fingerprint', async () => {
    const sentinelPin = '938271';
    const workers: WorkerCredentialCandidate[] = [
      { id: '60000000-0000-4000-8000-000000000001', shopId: SHOP_A, pinHash: await hashPin('222222'), pinLookupHash: 'a'.repeat(64), credentialVersion: 4, linkedEmployeeId: EMPLOYEE_ID },
    ];
    const loadWorkerStateFingerprint = vi.fn(async () => ({ ok: true as const, fingerprint: CANONICAL_FINGERPRINT }));
    const stageCredentialCommand = vi.fn<EmployeePinStore['stageCredentialCommand']>(async () => ({ ok: true as const, commandRef: '50000000-0000-4000-8000-000000000001', expectedCredentialVersion: 7, replayed: false }));
    const store = storeFixture({ listPinCollisionWorkers: vi.fn(async () => workers), loadWorkerStateFingerprint, stageCredentialCommand });

    expect((await prepareEmployeePinChange(request(sentinelPin), store)).ok).toBe(true);
    expect(loadWorkerStateFingerprint).toHaveBeenCalledWith({ actorEmployeeId: ACTOR_ID, businessId: BUSINESS_ID, employeeId: EMPLOYEE_ID, targetShopIds: [SHOP_A, SHOP_B] });
    const staged = stageCredentialCommand.mock.calls[0]?.[0];
    expect(JSON.stringify(staged)).not.toContain(sentinelPin);
    expect(staged?.workerStateFingerprint).toBe(CANONICAL_FINGERPRINT);
    expect(staged?.lookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPin(sentinelPin, staged?.verifierHash ?? '')).toBe(true);
  });

  it('fails closed when canonical fingerprint acquisition detects stale scope', async () => {
    const store = storeFixture({ loadWorkerStateFingerprint: vi.fn(async () => ({ ok: false as const, code: 'credential_scope_changed' })) });
    expect(await prepareEmployeePinChange(request(), store)).toEqual({ ok: false, code: 'credential_scope_changed' });
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });

  it('requires at least one canonical shop assignment', async () => {
    const store = storeFixture({ listAssignedShopIds: vi.fn(async () => []) });
    expect(await prepareEmployeePinChange(request(), store)).toEqual({ ok: false, code: 'employee_shop_assignment_required' });
  });
});
