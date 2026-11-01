export type ApiErrorKind =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'INVALID_RESPONSE';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: ApiErrorKind, status?: number, retryAfterSeconds?: number) {
    super(`API error: ${kind}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** True when the device likely has no usable connection; the UI may fall back to the offline cache. */
  get isConnectivity(): boolean {
    return this.kind === 'NETWORK' || this.kind === 'TIMEOUT';
  }
}

export function kindFromStatus(status: number): ApiErrorKind {
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER';
  return 'BAD_REQUEST';
}

export function isRetryable(error: ApiError): boolean {
  return error.kind === 'NETWORK' || error.kind === 'TIMEOUT' || error.kind === 'SERVER';
}
