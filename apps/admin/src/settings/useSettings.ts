import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminSettingsWorkspace, SettingsPublishResult } from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

export class SettingsUiError extends Error {
  constructor(
    readonly code: string,
    readonly currentVersion?: number,
  ) {
    super(code);
    this.name = 'SettingsUiError';
  }
}

function settingsQueryKey(shopId: string) {
  return ['admin', 'settings', shopId] as const;
}

function csrfTokenForMutation(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new SettingsUiError('session_required');
  return session.state.session.csrfToken;
}

export function useSettings(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: shopId ? settingsQueryKey(shopId) : ['admin', 'settings', 'no-shop'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      return adminFetch<AdminSettingsWorkspace>(
        `/api/admin/settings?shopId=${encodeURIComponent(shopId)}&view=workspace`,
      );
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!shopId) throw new SettingsUiError('concrete_shop_required');
      const workspace =
        queryClient.getQueryData<AdminSettingsWorkspace>(settingsQueryKey(shopId)) ??
        workspaceQuery.data;
      if (!workspace) throw new SettingsUiError('settings_not_loaded');

      const result = await adminFetch<SettingsPublishResult>(
        '/api/admin/settings',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'settings.publish',
            shopId,
            expectedSettingsVersion: workspace.settingsVersion,
          }),
        },
        csrfTokenForMutation(session),
      );

      if (!result.ok) {
        throw new SettingsUiError(
          result.code,
          result.code === 'stale_settings_version' ? result.currentVersion : undefined,
        );
      }
      return result;
    },
    onSuccess: async () => {
      if (!shopId) return;
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey(shopId) });
    },
  });

  return { workspaceQuery, publish };
}
