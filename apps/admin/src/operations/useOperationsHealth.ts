import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OperationsHealthResponse } from '@tux/admin-contracts';
import { useEffect, useRef } from 'react';

import { adminFetch } from '../lib/adminApi';

type HealthView = 'summary' | 'devices' | 'device';

export function useOperationsHealth(
  shopId: string | undefined,
  view: HealthView,
  deviceId?: string,
) {
  const queryClient = useQueryClient();
  const previousShopId = useRef(shopId);
  useEffect(() => {
    const previous = previousShopId.current;
    previousShopId.current = shopId;
    if (previous && previous !== shopId) {
      queryClient.removeQueries({ queryKey: ['admin', 'operations-health', previous] });
    }
  }, [queryClient, shopId]);

  return useQuery({
    queryKey: ['admin', 'operations-health', shopId ?? 'no-shop', view, deviceId ?? null],
    enabled: Boolean(shopId) && (view !== 'device' || Boolean(deviceId)),
    queryFn: () => {
      if (!shopId) throw new Error('concrete_shop_required');
      const params = new URLSearchParams({ view, shopId });
      if (deviceId) params.set('deviceId', deviceId);
      return adminFetch<OperationsHealthResponse>(
        `/api/admin/operations-health?${params.toString()}`,
      );
    },
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? 60_000 : false,
    refetchIntervalInBackground: false,
  });
}
