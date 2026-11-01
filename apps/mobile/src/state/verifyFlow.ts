import type { ApiClient, GeoPoint } from '../api/client';
import { ApiError, type ApiErrorKind } from '../api/errors';
import { isValidToken } from '../domain/token';
import { isUnrecognisedCode, loadResult, presentResult, saveResult, type Presentation } from '../storage/cache';
import { addHistory } from '../storage/history';
import type { KeyValueStore } from '../storage/kv';

export type VerifyOutcome =
  | { kind: 'fresh'; view: Presentation }
  | { kind: 'offline'; view: Presentation }
  | { kind: 'offlineNoCopy' }
  | { kind: 'error'; error: ApiErrorKind };

export interface VerifyDeps {
  api: Pick<ApiClient, 'verify'>;
  store: KeyValueStore;
  /** Only pass when the user has granted location; this app does not request it yet. */
  location?: GeoPoint;
  now?: () => number;
}

/**
 * Online: fetch, cache, add to history, present.
 * Connectivity failure: present the cached copy (stale, GREEN downgraded) or report no copy.
 * Any other error (404, 429, 5xx, bad payload) is shown as an error: the cache is NOT used to
 * mask a server-side "not found" or invalid answer.
 */
export async function runVerification(token: string, deps: VerifyDeps): Promise<VerifyOutcome> {
  const now = deps.now ?? Date.now;
  if (!isValidToken(token)) return { kind: 'error', error: 'NOT_FOUND' };
  try {
    const result = await deps.api.verify(token, deps.location);
    const fetchedAt = now();
    if (!isUnrecognisedCode(result)) {
      await saveResult(deps.store, token, result, fetchedAt);
      await addHistory(deps.store, token, result, fetchedAt);
    }
    return { kind: 'fresh', view: presentResult(result, { isCached: false, fetchedAt, now: fetchedAt }) };
  } catch (err) {
    if (!(err instanceof ApiError)) return { kind: 'error', error: 'NETWORK' };
    if (!err.isConnectivity) return { kind: 'error', error: err.kind };
    return fromCache(token, deps, now());
  }
}

async function fromCache(token: string, deps: VerifyDeps, now: number): Promise<VerifyOutcome> {
  const cached = await loadResult(deps.store, token);
  if (!cached) return { kind: 'offlineNoCopy' };
  return { kind: 'offline', view: presentResult(cached.result, { isCached: true, fetchedAt: cached.fetchedAt, now }) };
}
