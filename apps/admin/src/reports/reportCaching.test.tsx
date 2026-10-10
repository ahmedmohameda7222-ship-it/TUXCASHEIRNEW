import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  REPORT_CONFIG_STALE_TIME_MS,
  REPORT_FILTER_OPTIONS_STALE_TIME_MS,
  useReports,
} from './useReports';

const mock = vi.hoisted(() => ({
  queries: [] as Array<{ queryKey: unknown[]; staleTime?: number; enabled?: boolean }>,
  invalidate: vi.fn(),
  onSuccess: undefined as undefined | (() => Promise<unknown>),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[]; staleTime?: number; enabled?: boolean }) => {
    mock.queries.push(options);
    return { data: undefined };
  },
  useQueryClient: () => ({ invalidateQueries: mock.invalidate }),
  useMutation: (options: { onSuccess: () => Promise<unknown> }) => {
    mock.onSuccess = options.onSuccess;
    return { mutate: vi.fn() };
  },
}));
vi.mock('../auth/useAdminSession', () => ({
  useAdminSession: () => ({ state: { status: 'unauthenticated' } }),
}));

const filters = {
  area: 'sales' as const,
  fromDate: '2026-10-10',
  toDate: '2026-10-10',
  source: null,
  shopIds: ['32000000-0000-4000-8000-000000000001'],
  comparePrevious: false,
  offset: 0,
};

function ReportsConsumer({ optionsEnabled }: { optionsEnabled: boolean }) {
  useReports('32000000-0000-4000-8000-000000000001', filters, optionsEnabled);
  return <div>Reports</div>;
}

beforeEach(() => {
  mock.queries.length = 0;
  mock.invalidate.mockClear();
});

describe('Reports configuration and filter metadata caching', () => {
  it('caches configuration and defers filter metadata until requested', () => {
    renderToStaticMarkup(<ReportsConsumer optionsEnabled={false} />);
    const config = mock.queries.find((query) => query.queryKey.includes('config'));
    const options = mock.queries.find((query) => query.queryKey.includes('filter-options'));
    expect(config?.staleTime).toBe(REPORT_CONFIG_STALE_TIME_MS);
    expect(REPORT_CONFIG_STALE_TIME_MS).toBeGreaterThan(15_000);
    expect(options?.staleTime).toBe(REPORT_FILTER_OPTIONS_STALE_TIME_MS);
    expect(options?.enabled).toBe(false);

    mock.queries.length = 0;
    renderToStaticMarkup(<ReportsConsumer optionsEnabled={true} />);
    expect(mock.queries.find((query) => query.queryKey.includes('filter-options'))?.enabled).toBe(
      true,
    );
  });

  it('invalidates only the relevant config cache after a mutation', async () => {
    renderToStaticMarkup(<ReportsConsumer optionsEnabled={false} />);
    await mock.onSuccess?.();
    expect(mock.invalidate).toHaveBeenCalledTimes(1);
    expect(mock.invalidate).toHaveBeenCalledWith({
      queryKey: expect.arrayContaining(['admin', 'reports', 'config']),
    });
  });
});
