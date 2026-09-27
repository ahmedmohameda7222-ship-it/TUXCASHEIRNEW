import { describe, expect, it, vi } from 'vitest';

import { hashPin, verifyPin } from '../pin';
import {
  employeePinInternals,
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

function storeFixture(overrides: Partial<EmployeePinStore> = {}): EmployeePinStore {
  return {
    loadEmployeeCredentialState: vi.fn(async () => ({
      businessId: BUSINESS_ID,
      employeeId: EMPLOYEE_ID,
      active: true,
      credentialVersion: 7,
    })),
    listAssignedShopIds: vi.fn(async () => [SHOP_B, SHOP_A]),
    hasEmployeeLookupCollision: vi.fn(async () => false),
    listActiveWorkers: vi.fn(async () => []),
    stageCredentialCommand: vi.fn(async () => ({
      ok: true,
      commandRef: '50000000-0000-4000-8000-000000000001',
      expectedCredentialVersion: 7,
      replayed: false,
    })),
    ...overrides,
  };
}

describe('employee PIN coherence', () => {
  it('fails closed on invalid PIN format before staging anything', async () => {
    const store = storeFixture();
    const result = await prepareEmployeePinChange(
      {
        actorEmployeeId: ACTOR_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        pin: '12ab',
        lookupSecret: SECRET,
        commandId: COMMAND_ID,
        expiresAt: new Date('2026-09-27T12:00:00Z'),
      },
      store,
    );

    expect(result).toEqual({ ok: false, code: 'invalid_pin_format' });
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });

  it('rejects another active business employee lookup collision', async () => {
    const store = storeFixture({
      hasEmployeeLookupCollision: vi.fn(async () => true),
    });
    const result = await prepareEmployeePinChange(
      {
        actorEmployeeId: ACTOR_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        pin: '482731',
        lookupSecret: SECRET,
        commandId: COMMAND_ID,
        expiresAt: new Date('2026-09-27T12:00:00Z'),
      },
      store,
    );

    expect(result).toEqual({ ok: false, code: 'pin_already_in_use' });
    expect(store.listActiveWorkers).not.toHaveBeenCalled();
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });

  it('verifies the candidate against every other active worker salted hash', async () => {
    const workers: WorkerCredentialCandidate[] = [
      {
        id: '60000000-0000-4000-8000-000000000001',
        shopId: SHOP_A,
        pinHash: await hashPin('111111'),
        pinLookupHash: null,
        credentialVersion: 1,
        linkedEmployeeId: null,
      },
      {
        id: '60000000-0000-4000-8000-000000000002',
        shopId: SHOP_B,
        pinHash: await hashPin('482731'),
        pinLookupHash: null,
        credentialVersion: 1,
        linkedEmployeeId: null,
      },
      {
        id: '60000000-0000-4000-8000-000000000003',
        shopId: SHOP_B,
        pinHash: await hashPin('482731'),
        pinLookupHash: null,
        credentialVersion: 1,
        linkedEmployeeId: EMPLOYEE_ID,
      },
    ];
    const store = storeFixture({ listActiveWorkers: vi.fn(async () => workers) });

    const result = await prepareEmployeePinChange(
      {
        actorEmployeeId: ACTOR_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        pin: '482731',
        lookupSecret: SECRET,
        commandId: COMMAND_ID,
        expiresAt: new Date('2026-09-27T12:00:00Z'),
      },
      store,
    );

    expect(result).toEqual({ ok: false, code: 'pin_already_in_use' });
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });

  it('stages only one-way material and a deterministic worker-state fence', async () => {
    const sentinelPin = '938271';
    const workers: WorkerCredentialCandidate[] = [
      {
        id: '60000000-0000-4000-8000-000000000002',
        shopId: SHOP_B,
        pinHash: await hashPin('111111'),
        pinLookupHash: null,
        credentialVersion: 3,
        linkedEmployeeId: null,
      },
      {
        id: '60000000-0000-4000-8000-000000000001',
        shopId: SHOP_A,
        pinHash: await hashPin('222222'),
        pinLookupHash: 'a'.repeat(64),
        credentialVersion: 4,
        linkedEmployeeId: EMPLOYEE_ID,
      },
    ];
    const stageCredentialCommand = vi.fn(async () => ({
      ok: true as const,
      commandRef: '50000000-0000-4000-8000-000000000001',
      expectedCredentialVersion: 7,
      replayed: false,
    }));
    const store = storeFixture({
      listActiveWorkers: vi.fn(async () => workers),
      stageCredentialCommand,
    });

    const result = await prepareEmployeePinChange(
      {
        actorEmployeeId: ACTOR_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        pin: sentinelPin,
        lookupSecret: SECRET,
        commandId: COMMAND_ID,
        expiresAt: new Date('2026-09-27T12:00:00Z'),
      },
      store,
    );

    expect(result.ok).toBe(true);
    expect(stageCredentialCommand).toHaveBeenCalledOnce();
    const staged = stageCredentialCommand.mock.calls[0]?.[0];
    expect(staged).toBeDefined();
    expect(JSON.stringify(staged)).not.toContain(sentinelPin);
    expect(staged?.targetShopIds).toEqual([SHOP_A, SHOP_B]);
    expect(staged?.workerStateFingerprint).toBe(employeePinInternals.workerStateFingerprint(workers));
    expect(staged?.workerStateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(staged?.lookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(staged?.lookupHash).not.toContain(sentinelPin);
    expect(await verifyPin(sentinelPin, staged?.verifierHash ?? '')).toBe(true);
  });

  it('requires at least one canonical shop assignment', async () => {
    const store = storeFixture({ listAssignedShopIds: vi.fn(async () => []) });
    const result = await prepareEmployeePinChange(
      {
        actorEmployeeId: ACTOR_ID,
        businessId: BUSINESS_ID,
        employeeId: EMPLOYEE_ID,
        pin: '482731',
        lookupSecret: SECRET,
        commandId: COMMAND_ID,
        expiresAt: new Date('2026-09-27T12:00:00Z'),
      },
      store,
    );
    expect(result).toEqual({ ok: false, code: 'employee_shop_assignment_required' });
    expect(store.stageCredentialCommand).not.toHaveBeenCalled();
  });
});
