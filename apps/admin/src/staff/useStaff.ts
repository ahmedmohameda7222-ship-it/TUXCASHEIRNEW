import type { EmployeeDetail, StaffCommandResult, StaffWorkspace } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminApiFetch } from '../lib/adminApi';
import { createRetainedCommandIdFactory } from '../lib/retainedCommandIds';

export type StaffApiCommandDraft = Readonly<Record<string, unknown>> & { readonly type: string };

type StaffApiCommand = StaffApiCommandDraft & { readonly commandId: string };

type StaffCommandResponse = {
  readonly result: StaffCommandResult;
  readonly approval?: Readonly<Record<string, unknown>>;
};

function workspaceKey(shopId: string | undefined) { return ['admin','staff','workspace',shopId ?? 'all'] as const; }
function detailKey(employeeId: string | null | undefined, shopId: string | undefined) { return ['admin','staff','detail',shopId ?? 'all',employeeId ?? 'none'] as const; }

export function useStaff(shopId?: string, employeeId?: string | null) {
  const queryClient = useQueryClient();
  const retainCommandId = createRetainedCommandIdFactory();
  const workspaceQuery = useQuery({
    queryKey: workspaceKey(shopId), enabled: Boolean(shopId),
    queryFn: () => adminApiFetch<StaffWorkspace>(`/api/admin/staff?shopId=${encodeURIComponent(shopId ?? '')}`),
  });
  const detailQuery = useQuery({
    queryKey: detailKey(employeeId, shopId), enabled: Boolean(shopId && employeeId),
    queryFn: async () => {
      const response = await adminApiFetch<{ employee: EmployeeDetail }>(`/api/admin/staff?shopId=${encodeURIComponent(shopId ?? '')}&employeeId=${encodeURIComponent(employeeId ?? '')}`);
      return response.employee;
    },
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin','staff'] }),
      queryClient.invalidateQueries({ queryKey: ['admin','approvals'] }),
      queryClient.invalidateQueries({ queryKey: ['admin','dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['admin','finance'] }),
    ]);
  };
  const command = useMutation({
    mutationFn: async (draft: StaffApiCommandDraft) => {
      const suppliedCommandId = typeof draft['commandId'] === 'string' && draft['commandId'].trim() ? draft['commandId'] : null;
      const commandId = suppliedCommandId ?? retainCommandId(draft);
      const payload: StaffApiCommand = { ...draft, commandId };
      return adminApiFetch<StaffCommandResponse>('/api/admin/staff', { method: 'POST', body: payload });
    },
    onSuccess: async () => { retainCommandId.reset(); await invalidate(); },
  });
  const sensitiveCommand = useMutation({
    mutationFn: async ({ draft, pin }: { draft: StaffApiCommandDraft; pin: string }) => {
      const suppliedCommandId = typeof draft['commandId'] === 'string' && draft['commandId'].trim() ? draft['commandId'] : null;
      const commandId = suppliedCommandId ?? retainCommandId(draft);
      const approvalRouted = draft.type === 'employee.pin' || draft.type === 'employee.role' || draft.type === 'employee.permission' || draft.type === 'employee.suspend' || draft.type === 'payment.record';
      const payload: StaffApiCommand = approvalRouted
        ? { ...draft, requesterPin: pin, commandId }
        : { ...draft, commandId };
      return adminApiFetch<StaffCommandResponse>('/api/admin/staff', { method: 'POST', body: payload });
    },
    onSuccess: async () => { retainCommandId.reset(); await invalidate(); },
  });
  return { workspaceQuery, detailQuery, command, sensitiveCommand };
}
