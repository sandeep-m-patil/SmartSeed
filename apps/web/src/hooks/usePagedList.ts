import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PAGE_SIZE } from '../lib/constants';
import { buildQuery } from '../lib/format';
import { useApi } from './useApi';
import { usePagination, type Pagination } from './usePagination';

type Params = Record<string, string | number | undefined | null>;

export interface PagedList<T> {
  items: T[];
  nextCursor: string | null;
  pager: Pagination;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  refetch(): void;
}

interface Options {
  queryKey: string;
  path: string;
  params?: Params;
  pageSize?: number;
  enabled?: boolean;
}

/** Cursor-paginated list query. Changing `params` (filters) returns to the first page. */
export function usePagedList<T>({ queryKey, path, params = {}, pageSize = PAGE_SIZE, enabled = true }: Options): PagedList<T> {
  const api = useApi();
  const pager = usePagination();
  const paramsKey = JSON.stringify(params);
  const { reset } = pager;

  useEffect(() => {
    reset();
  }, [paramsKey, reset]);

  const query = useQuery({
    queryKey: [queryKey, paramsKey, pager.cursor ?? 'first'],
    queryFn: () => api.page<T>(`${path}${buildQuery({ ...params, limit: pageSize, cursor: pager.cursor })}`),
    placeholderData: keepPreviousData,
    enabled,
  });

  const next = query.data?.meta.nextCursor;
  return {
    items: query.data?.data ?? [],
    nextCursor: typeof next === 'string' ? next : null,
    pager,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
