import type { Batch, CachedResult, DisplayIndicator, VerifyResult } from '../domain/types';
import { deriveIndicator, worstIndicator } from '../domain/indicator';
import { readJson, type KeyValueStore } from './kv';

export const CACHE_KEY = 'smartseed.resultCache.v1';
export const MAX_CACHED_RESULTS = 30;

type CacheMap = Record<string, CachedResult>;

export async function saveResult(
  store: KeyValueStore,
  token: string,
  result: VerifyResult,
  now: number = Date.now(),
): Promise<void> {
  const map = await readJson<CacheMap>(store, CACHE_KEY, {});
  map[token] = { token, result, fetchedAt: now };
  const newest = Object.values(map)
    .sort((a, b) => b.fetchedAt - a.fetchedAt)
    .slice(0, MAX_CACHED_RESULTS);
  await store.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(newest.map((c) => [c.token, c]))));
}

export async function loadResult(store: KeyValueStore, token: string): Promise<CachedResult | null> {
  const map = await readJson<CacheMap>(store, CACHE_KEY, {});
  return map[token] ?? null;
}

export interface Presentation {
  indicator: DisplayIndicator;
  isStale: boolean;
  isExpired: boolean;
  /** Code not recognised by the server: always shown as a clear RED result, never cached. */
  isUnrecognised: boolean;
  fetchedAt: number;
  result: VerifyResult;
}

/** Expiry is re-evaluated locally so a cached "not expired" result cannot outlive its expiry date. */
export function isBatchExpired(batch: Batch | null, now: number): boolean {
  if (!batch) return false;
  const expiry = Date.parse(batch.expiryDate);
  return batch.expired || (!Number.isNaN(expiry) && expiry < now);
}

export function isUnrecognisedCode(result: VerifyResult): boolean {
  return result.verification.digitalIdentity === 'UNKNOWN' && result.product === null;
}

export interface PresentOptions {
  isCached: boolean;
  fetchedAt: number;
  now?: number;
}

/**
 * Turns a result into what the UI may display.
 * - indicator = worst of server indicator and local derivation (never safer than either).
 * - a cached GREEN is downgraded to the neutral LAST_CHECKED state: it is never shown as currently safe.
 */
export function presentResult(result: VerifyResult, options: PresentOptions): Presentation {
  const isExpired = isBatchExpired(result.batch, options.now ?? Date.now());
  const derived = deriveIndicator(result.verification, result.risk, isExpired);
  const merged = worstIndicator(result.indicator, derived);
  const isUnrecognised = isUnrecognisedCode(result);
  const safeMerged = isUnrecognised ? 'RED' : merged; // an unknown code is never anything but RED
  const indicator: DisplayIndicator = options.isCached && safeMerged === 'GREEN' ? 'LAST_CHECKED' : safeMerged;
  return { indicator, isStale: options.isCached, isExpired, isUnrecognised, fetchedAt: options.fetchedAt, result };
}
