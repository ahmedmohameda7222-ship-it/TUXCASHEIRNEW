import type { AdminSupabaseClient } from '../supabaseAdmin.js';
import type {
  EmployeePinStore,
  EmployeeCredentialState,
  StageEmployeeCredentialCommandInput,
  StageEmployeeCredentialCommandResult,
  WorkerCredentialCandidate,
  WorkerStateFingerprintResult,
} from './employeePin.js';

type EmployeeCredentialRow = {
  id: string;
  business_id: string;
  active: boolean;
  credential_version: number | string;
};

type AssignmentRow = { shop_id: string };

type WorkerRow = {
  id: string;
  shop_id: string;
  pin_hash: string;
  pin_lookup_hash: string | null;
  credential_version: number | string;
};

type WorkerLinkRow = {
  worker_id: string;
  employee_id: string;
};

function safeInteger(value: number | string): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new Error('staff_pin_backend_contract_invalid');
  }
  return result;
}

function inFilter(ids: readonly string[]): string {
  return `in.(${ids.join(',')})`;
}

export function createSupabaseEmployeePinStore(client: AdminSupabaseClient): EmployeePinStore {
  return {
    async loadEmployeeCredentialState({ businessId, employeeId }) {
      const rows = await client.select<EmployeeCredentialRow[]>(
        'business_employees',
        new URLSearchParams({
          select: 'id,business_id,active,credential_version',
          business_id: `eq.${businessId}`,
          id: `eq.${employeeId}`,
          limit: '1',
        }),
      );
      const row = rows[0];
      if (!row) return null;
      const state: EmployeeCredentialState = {
        businessId: row.business_id,
        employeeId: row.id,
        active: row.active,
        credentialVersion: safeInteger(row.credential_version),
      };
      return state;
    },

    async listAssignedShopIds({ businessId, employeeId }) {
      const rows = await client.select<AssignmentRow[]>(
        'employee_shop_assignments',
        new URLSearchParams({
          select: 'shop_id',
          business_id: `eq.${businessId}`,
          employee_id: `eq.${employeeId}`,
          order: 'shop_id.asc',
        }),
      );
      return rows.map((row) => row.shop_id);
    },

    async hasEmployeeLookupCollision({ businessId, employeeId, lookupHash }) {
      const rows = await client.select<Array<{ id: string }>>(
        'business_employees',
        new URLSearchParams({
          select: 'id',
          business_id: `eq.${businessId}`,
          active: 'eq.true',
          pin_lookup_hash: `eq.${lookupHash}`,
          id: `neq.${employeeId}`,
          limit: '1',
        }),
      );
      return rows.length > 0;
    },

    async listPinCollisionWorkers({ shopIds }) {
      if (shopIds.length === 0) return [];
      const workers = await client.select<WorkerRow[]>(
        'workers',
        new URLSearchParams({
          select: 'id,shop_id,pin_hash,pin_lookup_hash,credential_version',
          shop_id: inFilter(shopIds),
          active: 'eq.true',
          order: 'shop_id.asc,id.asc',
        }),
      );
      if (workers.length === 0) return [];

      const links = await client.select<WorkerLinkRow[]>(
        'employee_worker_links',
        new URLSearchParams({
          select: 'worker_id,employee_id',
          worker_id: inFilter(workers.map((worker) => worker.id)),
          active: 'eq.true',
        }),
      );
      const employeeByWorker = new Map(links.map((link) => [link.worker_id, link.employee_id]));

      return workers.map<WorkerCredentialCandidate>((worker) => ({
        id: worker.id,
        shopId: worker.shop_id,
        pinHash: worker.pin_hash,
        pinLookupHash: worker.pin_lookup_hash,
        credentialVersion: safeInteger(worker.credential_version),
        linkedEmployeeId: employeeByWorker.get(worker.id) ?? null,
      }));
    },

    async loadWorkerStateFingerprint(input): Promise<WorkerStateFingerprintResult> {
      const result = await client.rpc<Record<string, unknown>>(
        'get_employee_worker_state_fingerprint_v1',
        {
          p_actor_employee_id: input.actorEmployeeId,
          p_business_id: input.businessId,
          p_employee_id: input.employeeId,
          p_target_shop_ids: input.targetShopIds,
        },
      );
      if (result['ok'] !== true) {
        return {
          ok: false,
          code:
            typeof result['code'] === 'string'
              ? result['code']
              : 'worker_state_fingerprint_failed',
        };
      }
      if (
        typeof result['fingerprint'] !== 'string' ||
        !/^[0-9a-f]{64}$/.test(result['fingerprint'])
      ) {
        throw new Error('staff_pin_backend_contract_invalid');
      }
      return { ok: true, fingerprint: result['fingerprint'] };
    },

    async stageCredentialCommand(
      input: StageEmployeeCredentialCommandInput,
    ): Promise<StageEmployeeCredentialCommandResult> {
      const result = await client.rpc<Record<string, unknown>>('stage_employee_pin_change_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_employee_id: input.employeeId,
        p_target_shop_ids: input.targetShopIds,
        p_pin_verifier_hash: input.verifierHash,
        p_pin_lookup_hash: input.lookupHash,
        p_expected_credential_version: input.expectedCredentialVersion,
        p_worker_state_fingerprint: input.workerStateFingerprint,
        p_expires_at: input.expiresAt,
        p_command_id: input.commandId,
      });
      if (result['ok'] !== true) {
        return {
          ok: false,
          code:
            typeof result['code'] === 'string' ? result['code'] : 'credential_command_stage_failed',
        };
      }
      if (
        typeof result['commandRef'] !== 'string' ||
        typeof result['expectedCredentialVersion'] !== 'number'
      ) {
        throw new Error('staff_pin_backend_contract_invalid');
      }
      return {
        ok: true,
        commandRef: result['commandRef'],
        expectedCredentialVersion: result['expectedCredentialVersion'],
        replayed: result['replayed'] === true,
      };
    },
  };
}
