import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useOwnerSummary } from './useFinanceOperations';

const mock = vi.hoisted(() => ({ requests: [] as string[] }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { enabled: boolean; queryFn: () => Promise<unknown> }) => {
    if (options.enabled) void options.queryFn();
    return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../auth/useAdminSession', () => ({
  useAdminSession: () => ({ state: { status: 'unauthenticated' } }),
}));
vi.mock('../lib/adminApi', () => ({
  AdminApiError: class extends Error {},
  adminFetch: (path: string) => {
    mock.requests.push(path);
    return Promise.resolve({ summaries: [] });
  },
}));

function OwnerSummaryConsumer() {
  useOwnerSummary('32000000-0000-4000-8000-000000000001');
  return <div>Owner Summary</div>;
}

describe('Finance query activation', () => {
  it('issues only one Owner Summary GET with no incidental Finance requests', () => {
    mock.requests.length = 0;
    renderToStaticMarkup(<OwnerSummaryConsumer />);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toContain('view=owner-summary');
    for (const unrelated of [
      'days',
      'day-history',
      'expenses',
      'categories',
      'settlements',
      'recurring',
    ]) {
      expect(mock.requests[0]).not.toContain(`view=${unrelated}`);
    }
  });
});
