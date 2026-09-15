import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogRecurringAvailabilityWorkspace,
  CatalogSaveRecurringAvailabilityRuleInput,
  CatalogSaveRecurringAvailabilityRuleResult,
} from '@tux/admin-contracts';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { CatalogUiError } from './useCatalog';

type RecurringRuleDraft = Omit<CatalogSaveRecurringAvailabilityRuleInput, 'shopId'>;

function recurringAvailabilityQueryKey(shopId: string) {
  return ['admin', 'catalog', shopId, 'recurring-availability'] as const;
}

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new CatalogUiError('session_required');
  return session.state.session.csrfToken;
}

export function useRecurringAvailability(shopId: string | undefined) {
  const session = useAdminSession();
  const queryClient = useQueryClient();

  const recurringQuery = useQuery({
    queryKey: shopId
      ? recurringAvailabilityQueryKey(shopId)
      : ['admin', 'catalog', 'no-shop', 'recurring-availability'],
    enabled: Boolean(shopId),
    queryFn: async () => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      return adminFetch<CatalogRecurringAvailabilityWorkspace>(
        `/api/admin/catalog?shopId=${encodeURIComponent(shopId)}&view=recurring-availability`,
      );
    },
  });

  const saveRule = useMutation({
    mutationFn: async (input: RecurringRuleDraft) => {
      if (!shopId) throw new CatalogUiError('concrete_shop_required');
      const result = await adminFetch<CatalogSaveRecurringAvailabilityRuleResult>(
        '/api/admin/catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'availability.recurring.save',
            shopId,
            ...input,
          }),
        },
        csrfToken(session),
      );
      if (!result.ok) {
        throw new CatalogUiError(
          result.code,
          'currentVersion' in result ? result.currentVersion : undefined,
        );
      }
      return result;
    },
    async onSuccess() {
      if (!shopId) return;
      await queryClient.invalidateQueries({ queryKey: ['admin', 'catalog', shopId] });
    },
  });

  return { recurringQuery, saveRule };
}
