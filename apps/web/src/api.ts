export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface Envelope<T> {
  data: T | null;
  meta: Record<string, unknown>;
  error: { code: string; message: string; details?: unknown } | null;
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiResult<T> {
  data: T;
  meta: Record<string, unknown>;
}

function buildInit({ method = 'GET', body, token, headers, signal }: RequestOptions): RequestInit {
  return {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  };
}

/** Like `api` but also returns the envelope `meta` (pagination cursor, replay flag...). */
export async function apiWithMeta<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  const res = await fetch(path, buildInit(opts));
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json || json.error) {
    throw new ApiError(res.status, json?.error?.code ?? 'NETWORK_ERROR', json?.error?.message ?? 'Request failed', json?.error?.details);
  }
  return { data: json.data as T, meta: json.meta ?? {} };
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await apiWithMeta<T>(path, opts)).data;
}

/** Fetches a binary download (QR images); failure bodies are JSON envelopes. */
export async function apiBlob(path: string, token: string | null): Promise<Blob> {
  const res = await fetch(path, buildInit({ token }));
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as Envelope<unknown> | null;
    throw new ApiError(res.status, json?.error?.code ?? 'NETWORK_ERROR', json?.error?.message ?? 'Download failed');
  }
  return res.blob();
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

/** True when an endpoint is not deployed yet (404 / 501) - screens show an "unavailable" state. */
export function isUnavailable(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 501);
}
