import { createHash } from 'node:crypto';

import { hashPin, pinLookupHash, verifyPin } from '../pin.js';

export type EmployeeCredentialState = {
  readonly businessId: string;
  readonly employeeId: string;
  readonly active: boolean;
  readonly credentialVersion: number;
};

export type WorkerCredentialCandidate = {
  readonly id: string;
  readonly shopId: string;
  readonly pinHash: string;
  readonly pinLookupHash: string | null;
  readonly credentialVersion: number;
  readonly linkedEmployeeId: string | null;
};

export type StageEmployeeCredentialCommandInput = {
  readonly actorEmployeeId: string;
  readonly employeeId: string;
  readonly targetShopIds: readonly string[];
  readonly verifierHash: string;
  readonly lookupHash: string;
  readonly expectedCredentialVersion: number;
  readonly workerStateFingerprint: string;
  readonly expiresAt: string;
  readonly commandId: string;
};

export type StageEmployeeCredentialCommandResult =
  | {
      readonly ok: true;
      readonly commandRef: string;
      readonly expectedCredentialVersion: number;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly code: string };

export interface EmployeePinStore {
  loadEmployeeCredentialState(input: {
    businessId: string;
    employeeId: string;
  }): Promise<EmployeeCredentialState | null>;
  listAssignedShopIds(input: {
    businessId: string;
    employeeId: string;
  }): Promise<readonly string[]>;
  hasEmployeeLookupCollision(input: {
    businessId: string;
    employeeId: string;
    lookupHash: string;
  }): Promise<boolean>;
  listActiveWorkers(input: {
    businessId: string;
    shopIds: readonly string[];
  }): Promise<readonly WorkerCredentialCandidate[]>;
  stageCredentialCommand(
    input: StageEmployeeCredentialCommandInput,
  ): Promise<StageEmployeeCredentialCommandResult>;
}

export type PrepareEmployeePinChangeInput = {
  readonly actorEmployeeId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly pin: string;
  readonly lookupSecret: string;
  readonly commandId: string;
  readonly expiresAt: Date;
};

export type PreparedEmployeePinChange =
  | {
      readonly ok: true;
      readonly commandRef: string;
      readonly targetShopIds: readonly string[];
      readonly expectedCredentialVersion: number;
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly code: string };

function normalizedShopIds(shopIds: readonly string[]): readonly string[] {
  return [...new Set(shopIds)].sort();
}

function workerStateFingerprint(workers: readonly WorkerCredentialCandidate[]): string {
  const material = [...workers]
    .sort((left, right) =>
      left.shopId === right.shopId
        ? left.id.localeCompare(right.id)
        : left.shopId.localeCompare(right.shopId),
    )
    .map((worker) =>
      [
        worker.shopId,
        worker.id,
        'true',
        worker.pinHash,
        worker.pinLookupHash ?? '',
        String(worker.credentialVersion),
        worker.linkedEmployeeId ?? '',
      ].join(':'),
    )
    .join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

export async function prepareEmployeePinChange(
  input: PrepareEmployeePinChangeInput,
  store: EmployeePinStore,
): Promise<PreparedEmployeePinChange> {
  // hashPin and pinLookupHash share the canonical PIN format validator.
  let lookupHash: string;
  try {
    lookupHash = await pinLookupHash(input.pin, input.lookupSecret);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error ? error.message : 'invalid_pin_format',
    };
  }

  const state = await store.loadEmployeeCredentialState({
    businessId: input.businessId,
    employeeId: input.employeeId,
  });
  if (!state || state.businessId !== input.businessId) {
    return { ok: false, code: 'employee_not_found' };
  }
  if (!state.active) return { ok: false, code: 'employee_inactive' };

  if (
    await store.hasEmployeeLookupCollision({
      businessId: input.businessId,
      employeeId: input.employeeId,
      lookupHash,
    })
  ) {
    return { ok: false, code: 'pin_already_in_use' };
  }

  const targetShopIds = normalizedShopIds(
    await store.listAssignedShopIds({
      businessId: input.businessId,
      employeeId: input.employeeId,
    }),
  );
  if (targetShopIds.length === 0) {
    return { ok: false, code: 'employee_shop_assignment_required' };
  }

  const workers = await store.listActiveWorkers({
    businessId: input.businessId,
    shopIds: targetShopIds,
  });

  let workerCollision = false;
  for (const worker of workers) {
    if (worker.linkedEmployeeId === input.employeeId) continue;
    // Salted hashes are never compared for equality. Verify the entered value
    // against each active worker's canonical Operations verifier format.
    if (await verifyPin(input.pin, worker.pinHash)) workerCollision = true;
  }
  if (workerCollision) return { ok: false, code: 'pin_already_in_use' };

  const verifierHash = await hashPin(input.pin);
  const staged = await store.stageCredentialCommand({
    actorEmployeeId: input.actorEmployeeId,
    employeeId: input.employeeId,
    targetShopIds,
    verifierHash,
    lookupHash,
    expectedCredentialVersion: state.credentialVersion,
    workerStateFingerprint: workerStateFingerprint(workers),
    expiresAt: input.expiresAt.toISOString(),
    commandId: input.commandId,
  });

  if (!staged.ok) return staged;
  return {
    ok: true,
    commandRef: staged.commandRef,
    targetShopIds,
    expectedCredentialVersion: staged.expectedCredentialVersion,
    replayed: staged.replayed,
  };
}

export const employeePinInternals = { workerStateFingerprint };
