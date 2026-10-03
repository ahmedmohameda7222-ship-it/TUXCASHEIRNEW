import type { EmployeeDetail, StaffCommandResult, StaffWorkspace } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { AdminApiError, adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds, isPendingApprovalResult } from '../lib/retainedCommandIds';

export type StaffApiCommandDraft = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

const SECRET_COMMAND_KEY = /(pin|password|passcode|secret|verifier|lookup|salt)/i;
const APPROVAL_PIN_COMMAND_TYPES = new Set([
  'employee.pin',
  'employee.role',
  'employee.permission',
  'employee.suspend',
  'payment.record',
]);

export function staffCommandIntentForRetention(
  draft: StaffApiCommandDraft,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(draft).filter(([key]) => !SECRET_COMMAND_KEY.test(key)));
}

export function staffEphemeralCommandId(draft: StaffApiCommandDraft): string | null {
  return draft.type === 'employee.pin' && typeof draft['commandId'] === 'string'
    ? draft['commandId']
    : null;
}

export function createEphemeralStaffCommandIds(createId: () => string = () => crypto.randomUUID()) {
  const active = new Map<string, string>();
  return {
    forSeed(seed: string): string {
      const current = active.get(seed);
      if (current) return current;
      active.set(seed, seed);
      return seed;
    },
    complete(seed: string): void {
      active.set(seed, createId());
    },
  };
}

export function staffCommandUsesApprovalPin(draft: StaffApiCommandDraft): boolean {
  return APPROVAL_PIN_COMMAND_TYPES.has(draft.type);
}

export function staffCommandErrorIsTerminal(error: unknown): boolean {
  return error instanceof AdminApiError;
}

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new Error('session_required');
  return session.state.session.csrfToken;
}

export function useStaff(shopId: string | undefined, employeeId: string | null) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);
  const ephemeralCommandIds = useMemo(() => createEphemeralStaffCommandIds(), [namespace]);

  const workspaceQuery = useQuery({
    queryKey: ['admin', 'staff', shopId, 'workspace'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<StaffWorkspace>(`/api/admin/staff?shopId=${encodeURIComponent(shopId!)}`),
  });

  const detailQuery = useQuery({
    queryKey: ['admin', 'staff', shopId, 'employee', employeeId],
    enabled: Boolean(shopId && employeeId),
    queryFn: () =>
      adminFetch<{ employee: EmployeeDetail }>(
        `/api/admin/staff?shopId=${encodeURIComponent(
          shopId!,
        )}&employeeId=${encodeURIComponent(employeeId!)}`,
      ).then((result) => result.employee),
  });

  async function postCommand(draft: StaffApiCommandDraft, requesterPin?: string) {
    if (!shopId) throw new Error('concrete_shop_required');
    const intent = staffCommandIntentForRetention(draft);
    const scope = `staff.${draft.type}`;
    const ephemeralCommandSeed = staffEphemeralCommandId(draft);
    const commandId =
      ephemeralCommandSeed === null
        ? commandIds.forIntent(scope, intent)
        : ephemeralCommandIds.forSeed(ephemeralCommandSeed);

    try {
      const result = await adminFetch<StaffCommandResult>(
        '/api/admin/staff',
        {
          method: 'POST',
          body: JSON.stringify({
            ...draft,
            commandId,
            ...(requesterPin === undefined ? {} : { requesterPin }),
          }),
        },
        csrfToken(session),
      );
      if (!isPendingApprovalResult(result)) {
        if (ephemeralCommandSeed === null) commandIds.complete(scope, intent);
        else ephemeralCommandIds.complete(ephemeralCommandSeed);
      }
      return result;
    } catch (error) {
      if (staffCommandErrorIsTerminal(error)) {
        if (ephemeralCommandSeed === null) commandIds.complete(scope, intent);
        else ephemeralCommandIds.complete(ephemeralCommandSeed);
      }
      throw error;
    }
  }

  const command = useMutation({
    mutationFn: (draft: StaffApiCommandDraft) => postCommand(draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'staff', shopId] });
    },
  });

  const sensitiveCommand = useMutation({
    mutationFn: async ({ draft, pin }: { draft: StaffApiCommandDraft; pin: string }) => {
      await adminFetch<{ ok: true; reauthenticatedAt: string }>(
        '/api/admin/reauth',
        {
          method: 'POST',
          body: JSON.stringify({ pin }),
        },
        csrfToken(session),
      );
      return postCommand(draft, staffCommandUsesApprovalPin(draft) ? pin : undefined);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'staff', shopId] });
    },
  });

  return { workspaceQuery, detailQuery, command, sensitiveCommand };
}
