import type {
  EmployeeDetail,
  StaffCommandResult,
  StaffWorkspace,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';

export type StaffApiCommandDraft = Readonly<Record<string, unknown>> & {
  readonly type: string;
};

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

  const workspaceQuery = useQuery({
    queryKey: ['admin', 'staff', shopId, 'workspace'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<StaffWorkspace>(
        `/api/admin/staff?shopId=${encodeURIComponent(shopId!)}`,
      ),
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

  const command = useMutation({
    mutationFn: async (draft: StaffApiCommandDraft) => {
      if (!shopId) throw new Error('concrete_shop_required');
      const intent = { ...draft };
      const scope = `staff.${draft.type}`;
      const commandId = commandIds.forIntent(scope, intent);
      const result = await adminFetch<StaffCommandResult>(
        '/api/admin/staff',
        {
          method: 'POST',
          body: JSON.stringify({ ...draft, commandId }),
        },
        csrfToken(session),
      );
      commandIds.complete(scope, intent);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'staff', shopId] });
    },
  });

  return { workspaceQuery, detailQuery, command };
}
