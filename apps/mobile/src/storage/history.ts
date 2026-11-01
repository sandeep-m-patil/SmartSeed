import type { HistoryEntry, VerifyResult } from '../domain/types';
import { readJson, type KeyValueStore } from './kv';

export const HISTORY_KEY = 'smartseed.history.v1';
export const MAX_HISTORY = 100;

export async function loadHistory(store: KeyValueStore): Promise<HistoryEntry[]> {
  return readJson<HistoryEntry[]>(store, HISTORY_KEY, []);
}

/**
 * History stores no safety verdict on purpose: a past "green" must never be shown as current safety.
 * Opening an entry re-checks online (or shows the cached copy with the outdated banner).
 */
export async function addHistory(
  store: KeyValueStore,
  token: string,
  result: VerifyResult,
  now: number = Date.now(),
): Promise<void> {
  if (!result.product || !result.batch) return; // unrecognised codes are not recorded
  const existing = await loadHistory(store);
  const entry: HistoryEntry = {
    token,
    productName: result.product.name,
    batchCode: result.batch.code,
    checkedAt: now,
  };
  const next = [entry, ...existing.filter((e) => e.token !== token)].slice(0, MAX_HISTORY);
  await store.setItem(HISTORY_KEY, JSON.stringify(next));
}

export async function clearHistory(store: KeyValueStore): Promise<void> {
  await store.removeItem(HISTORY_KEY);
}
