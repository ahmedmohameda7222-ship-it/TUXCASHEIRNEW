import { QueryClient } from '@tanstack/react-query';

import { AdminApiError } from '../lib/adminApi';

export function shouldRetryAdminQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof AdminApiError) return error.status >= 500;
  return true;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: shouldRetryAdminQuery,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
