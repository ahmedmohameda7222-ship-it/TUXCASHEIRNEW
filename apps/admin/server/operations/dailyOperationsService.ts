import type {
  AdminSessionPrincipal,
  DailyChecklistKind,
  DailyChecklistWorkspace,
  ManagerLogPage,
} from '@tux/admin-contracts';

import { requirePermission } from '../authorization.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export type DailyMutationResult = {
  ok: boolean;
  code?: string;
  replayed?: boolean;
  entryId?: string;
  runId?: string;
};
export type CompleteChecklistInput = {
  shopId: string;
  kind: DailyChecklistKind;
  businessDayId: string | null;
  templateId: string;
  expectedVersion: number;
  doneItemIds: string[];
  commandId: string;
};
export type AppendManagerNoteInput = {
  shopId: string;
  note: string;
  correctionOfId: string | null;
  commandId: string;
};
type CompleteChecklistStoreInput = CompleteChecklistInput & {
  businessId: string;
  actorEmployeeId: string;
};
type AppendManagerNoteStoreInput = AppendManagerNoteInput & {
  businessId: string;
  actorEmployeeId: string;
};

export type DailyOperationsDependencies = {
  readChecklist(input: {
    businessId: string;
    actorEmployeeId: string;
    shopId: string;
    kind: DailyChecklistKind;
  }): Promise<DailyChecklistWorkspace>;
  readManagerLog(input: {
    businessId: string;
    actorEmployeeId: string;
    shopId: string;
    cursor: string | null;
    limit: number;
  }): Promise<ManagerLogPage>;
  completeChecklist(input: CompleteChecklistStoreInput): Promise<DailyMutationResult>;
  appendManagerNote(input: AppendManagerNoteStoreInput): Promise<DailyMutationResult>;
};

function validNote(note: string): boolean {
  const safeCharacters = Array.from(note).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 32 && codePoint !== 127 && character !== '<' && character !== '>';
  });
  return note.length > 0 && note.length <= 2_000 && safeCharacters;
}

export function createDailyOperationsService(deps: DailyOperationsDependencies) {
  return {
    readChecklist(
      input: { shopId: string; kind: DailyChecklistKind },
      principal: AdminSessionPrincipal,
    ) {
      requirePermission(principal, 'devices.view', input.shopId);
      return deps.readChecklist({
        ...input,
        businessId: principal.businessId,
        actorEmployeeId: principal.employeeId,
      });
    },
    readManagerLog(
      input: { shopId: string; cursor: string | null; limit: number },
      principal: AdminSessionPrincipal,
    ) {
      requirePermission(principal, 'devices.view', input.shopId);
      return deps.readManagerLog({
        ...input,
        businessId: principal.businessId,
        actorEmployeeId: principal.employeeId,
      });
    },
    completeChecklist(
      input: CompleteChecklistInput,
      principal: AdminSessionPrincipal,
    ): Promise<DailyMutationResult> {
      requirePermission(principal, 'devices.manage', input.shopId);
      if (input.businessDayId === null)
        return Promise.resolve({ ok: false, code: 'business_day_required' });
      return deps.completeChecklist({
        ...input,
        businessId: principal.businessId,
        actorEmployeeId: principal.employeeId,
      });
    },
    appendManagerNote(
      input: AppendManagerNoteInput,
      principal: AdminSessionPrincipal,
    ): Promise<DailyMutationResult> {
      requirePermission(principal, 'devices.manage', input.shopId);
      const note = input.note.trim();
      if (!validNote(note)) return Promise.resolve({ ok: false, code: 'manager_note_invalid' });
      return deps.appendManagerNote({
        ...input,
        note,
        businessId: principal.businessId,
        actorEmployeeId: principal.employeeId,
      });
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('daily_operations_backend_contract_invalid');
  return value as Record<string, unknown>;
}

export function createSupabaseDailyOperationsDependencies(
  client: AdminSupabaseClient,
): DailyOperationsDependencies {
  return {
    async readChecklist(input) {
      return client.rpc<DailyChecklistWorkspace>('get_admin_daily_checklist_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_shop_id: input.shopId,
        p_kind: input.kind,
      });
    },
    async readManagerLog(input) {
      return client.rpc<ManagerLogPage>('get_admin_manager_log_v1', {
        p_actor_employee_id: input.actorEmployeeId,
        p_shop_id: input.shopId,
        p_cursor: input.cursor,
        p_limit: input.limit,
      });
    },
    async completeChecklist(input) {
      const result = asRecord(
        await client.rpc('complete_admin_daily_checklist_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_shop_id: input.shopId,
          p_business_day_id: input.businessDayId,
          p_kind: input.kind,
          p_template_id: input.templateId,
          p_expected_version: input.expectedVersion,
          p_done_item_ids: input.doneItemIds,
          p_command_id: input.commandId,
        }),
      );
      return {
        ok: result['ok'] === true,
        ...(typeof result['code'] === 'string' ? { code: result['code'] } : {}),
        ...(typeof result['replayed'] === 'boolean' ? { replayed: result['replayed'] } : {}),
        ...(typeof result['runId'] === 'string' ? { runId: result['runId'] } : {}),
      };
    },
    async appendManagerNote(input) {
      const result = asRecord(
        await client.rpc('append_admin_manager_log_v1', {
          p_actor_employee_id: input.actorEmployeeId,
          p_shop_id: input.shopId,
          p_note: input.note,
          p_correction_of_id: input.correctionOfId,
          p_command_id: input.commandId,
        }),
      );
      return {
        ok: result['ok'] === true,
        ...(typeof result['code'] === 'string' ? { code: result['code'] } : {}),
        ...(typeof result['replayed'] === 'boolean' ? { replayed: result['replayed'] } : {}),
        ...(typeof result['entryId'] === 'string' ? { entryId: result['entryId'] } : {}),
      };
    },
  };
}
