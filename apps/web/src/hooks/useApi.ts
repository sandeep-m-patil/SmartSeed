import { useMemo } from 'react';
import { ApiError, api, apiBlob, apiWithMeta, type ApiResult, type HttpMethod } from '../api';
import { useAuth } from '../auth';

export interface SendOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  page<T>(path: string): Promise<ApiResult<T[]>>;
  send<T>(path: string, options?: SendOptions): Promise<ApiResult<T>>;
  blob(path: string): Promise<Blob>;
}

/** Authenticated API client: attaches the in-memory bearer token and retries once after a token refresh on 401. */
export function useApi(): ApiClient {
  const { getAccessToken, refreshSession } = useAuth();
  return useMemo(() => {
    async function withAuth<R>(run: (token: string | null) => Promise<R>): Promise<R> {
      try {
        return await run(getAccessToken());
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) throw err;
        const fresh = await refreshSession();
        if (!fresh) throw err;
        return run(fresh);
      }
    }
    return {
      get: <T,>(path: string) => withAuth((token) => api<T>(path, { token })),
      page: <T,>(path: string) => withAuth((token) => apiWithMeta<T[]>(path, { token })),
      send: <T,>(path: string, { method = 'POST', body, headers }: SendOptions = {}) =>
        withAuth((token) => apiWithMeta<T>(path, { method, token, ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) })),
      blob: (path: string) => withAuth((token) => apiBlob(path, token)),
    };
  }, [getAccessToken, refreshSession]);
}
