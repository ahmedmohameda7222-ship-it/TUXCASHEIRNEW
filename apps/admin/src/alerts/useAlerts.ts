import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { AdminAlertsPage, AlertSeverity, AlertSource } from '@tux/admin-contracts';

import { adminFetch } from '../lib/adminApi';

export type AlertsFilters = {
  source: AlertSource | 'ALL';
  severity: AlertSeverity | 'ALL';
  state: 'ACTIVE' | 'RESOLVED' | 'ALL';
};

export const DEFAULT_ALERT_FILTERS: AlertsFilters = {
  source: 'ALL',
  severity: 'ALL',
  state: 'ACTIVE',
};

export function useAlerts(shopId: string | undefined, filters: AlertsFilters) {
  const queryClient = useQueryClient();
  const previousShopId = useRef<string | undefined>(shopId);

  useEffect(() => {
    const previous = previousShopId.current;
    previousShopId.current = shopId;
    if (previous && previous !== shopId) {
      queryClient.removeQueries({ queryKey: ['admin', 'alerts', previous] });
    }
  }, [queryClient, shopId]);

  return useQuery({
    queryKey: ['admin', 'alerts', shopId ?? 'no-shop', filters],
    enabled: Boolean(shopId),
    queryFn: () => {
      if (!shopId) throw new Error('concrete_shop_required');
      const params = new URLSearchParams({ shopId, limit: '50' });
      if (filters.source !== 'ALL') params.set('source', filters.source);
      if (filters.severity !== 'ALL') params.set('severity', filters.severity);
      if (filters.state !== 'ALL') params.set('state', filters.state);
      return adminFetch<AdminAlertsPage>(`/api/admin/alerts?${params.toString()}`);
    },
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
}
