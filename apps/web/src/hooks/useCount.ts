import { useQuery } from '@tanstack/react-query';
import { COUNT_FETCH_LIMIT } from '../lib/constants';
import { buildQuery } from '../lib/format';
import { useApi } from './useApi';

export interface CountResult<T> {
  /** Items on the first page (at most COUNT_FETCH_LIMIT). */
  items: T[];
  count: number;
  /** True when more rows exist beyond the first page, so `count` is a lower bound. */
  hasMore: boolean;
  isLoading: boolean;
  error: unknown;
}

/** Derives dashboard figures from a real list endpoint; never invents numbers. */
export function useListSnapshot<T>(key: string, path: string, params: Record<string, string> = {}, enabled = true): CountResult<T> {
  const api = useApi();
  const q = useQuery({
    queryKey: ['snapshot', key, params],
    queryFn: () => api.page<T>(`${path}${buildQuery({ ...params, limit: COUNT_FETCH_LIMIT })}`),
    enabled,
  });
  const items = q.data?.data ?? [];
  return { items, count: items.length, hasMore: Boolean(q.data?.meta.nextCursor), isLoading: q.isLoading && enabled, error: q.error };
}

export const formatCount = (count: number, hasMore: boolean): string => `${count.toLocaleString()}${hasMore ? '+' : ''}`;
