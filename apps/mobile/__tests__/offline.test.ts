import { ApiError } from '../src/api/errors';
import { buildStatusRows } from '../src/domain/statusRows';
import { loadResult, presentResult, saveResult, MAX_CACHED_RESULTS } from '../src/storage/cache';
import { loadHistory } from '../src/storage/history';
import { createMemoryStore } from '../src/storage/kv';
import { runVerification } from '../src/state/verifyFlow';
import { BATCH, TOKEN, makeResult, makeUnknownResult } from './fixtures';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const online = (result = makeResult()) => ({ verify: jest.fn().mockResolvedValue(result) });
const offline = (err = new ApiError('NETWORK')) => ({ verify: jest.fn().mockRejectedValue(err) });

describe('cache and downgrade', () => {
  it('stores and loads the last result per token with a timestamp', async () => {
    const store = createMemoryStore();
    await saveResult(store, TOKEN, makeResult(), 123);
    const cached = await loadResult(store, TOKEN);
    expect(cached?.fetchedAt).toBe(123);
    expect(cached?.result.batch?.code).toBe('B-2026-001');
  });

  it('evicts the oldest entries beyond the cap', async () => {
    const store = createMemoryStore();
    for (let i = 0; i < MAX_CACHED_RESULTS + 5; i++) await saveResult(store, `T${i}`.padEnd(22, 'x'), makeResult(), i);
    expect(await loadResult(store, 'T0'.padEnd(22, 'x'))).toBeNull();
    expect(await loadResult(store, `T${MAX_CACHED_RESULTS + 4}`.padEnd(22, 'x'))).not.toBeNull();
  });

  it('survives corrupt storage', async () => {
    const store = createMemoryStore();
    await store.setItem('smartseed.resultCache.v1', '{not json');
    expect(await loadResult(store, TOKEN)).toBeNull();
  });

  it('fresh GREEN stays GREEN', () => {
    expect(presentResult(makeResult(), { isCached: false, fetchedAt: NOW, now: NOW }).indicator).toBe('GREEN');
  });

  it('cached GREEN is downgraded to neutral LAST_CHECKED and marked stale', () => {
    const view = presentResult(makeResult(), { isCached: true, fetchedAt: NOW - 1000, now: NOW });
    expect(view.indicator).toBe('LAST_CHECKED');
    expect(view.isStale).toBe(true);
  });

  it('cached YELLOW and RED are kept (warnings are never softened)', () => {
    const yellow = makeResult({ indicator: 'YELLOW', verification: { ...makeResult().verification, scanActivity: 'SUSPICIOUS' } });
    const red = makeResult({ indicator: 'RED', verification: { ...makeResult().verification, blockchain: 'FAILED' } });
    expect(presentResult(yellow, { isCached: true, fetchedAt: 1, now: NOW }).indicator).toBe('YELLOW');
    expect(presentResult(red, { isCached: true, fetchedAt: 1, now: NOW }).indicator).toBe('RED');
  });

  it('stale "ok" status rows are neutral, never green', () => {
    const rows = buildStatusRows(makeResult().verification, true);
    expect(rows.map((r) => r.level)).toEqual(['neutral', 'neutral', 'neutral', 'neutral']);
  });
});

describe('defence in depth against a wrong server indicator', () => {
  it('server says GREEN but chain FAILED -> RED', () => {
    const bad = makeResult({ indicator: 'GREEN', verification: { ...makeResult().verification, blockchain: 'FAILED' } });
    expect(presentResult(bad, { isCached: false, fetchedAt: NOW, now: NOW }).indicator).toBe('RED');
  });

  it('server says GREEN but chain UNVERIFIED -> YELLOW', () => {
    const bad = makeResult({ indicator: 'GREEN', verification: { ...makeResult().verification, blockchain: 'UNVERIFIED' } });
    expect(presentResult(bad, { isCached: false, fetchedAt: NOW, now: NOW }).indicator).toBe('YELLOW');
  });

  it('server says RED but local derivation is GREEN -> stays RED', () => {
    expect(presentResult(makeResult({ indicator: 'RED' }), { isCached: false, fetchedAt: NOW, now: NOW }).indicator).toBe('RED');
  });
});

describe('expired batch handling', () => {
  it('server-flagged expired batch is not GREEN and is marked expired', () => {
    const r = makeResult({ batch: { ...BATCH, expired: true } });
    const view = presentResult(r, { isCached: false, fetchedAt: NOW, now: NOW });
    expect(view.isExpired).toBe(true);
    expect(view.indicator).toBe('YELLOW');
  });

  it('a cached "not expired" result is re-evaluated against today and becomes expired', () => {
    const r = makeResult({ batch: { ...BATCH, expiryDate: '2026-06-01', expired: false } });
    const view = presentResult(r, { isCached: false, fetchedAt: NOW, now: NOW });
    expect(view.isExpired).toBe(true);
    expect(view.indicator).not.toBe('GREEN');
  });
});

describe('runVerification offline flow', () => {
  it('online: returns fresh, caches, and records history without a verdict', async () => {
    const store = createMemoryStore();
    const out = await runVerification(TOKEN, { api: online(), store, now: () => NOW });
    expect(out).toMatchObject({ kind: 'fresh', view: { indicator: 'GREEN', isStale: false } });
    expect((await loadResult(store, TOKEN))?.fetchedAt).toBe(NOW);
    const history = await loadHistory(store);
    expect(history).toHaveLength(1);
    expect(Object.keys(history[0] ?? {})).not.toContain('indicator');
  });

  it('offline with a cached GREEN: shows cached copy as LAST_CHECKED, stale', async () => {
    const store = createMemoryStore();
    await runVerification(TOKEN, { api: online(), store, now: () => NOW });
    const out = await runVerification(TOKEN, { api: offline(), store, now: () => NOW + 86_400_000 });
    expect(out).toMatchObject({ kind: 'offline', view: { indicator: 'LAST_CHECKED', isStale: true, fetchedAt: NOW } });
  });

  it('timeout is treated like offline', async () => {
    const store = createMemoryStore();
    await saveResult(store, TOKEN, makeResult(), NOW);
    const out = await runVerification(TOKEN, { api: offline(new ApiError('TIMEOUT')), store, now: () => NOW });
    expect(out.kind).toBe('offline');
  });

  it('offline with nothing cached: offlineNoCopy', async () => {
    const out = await runVerification(TOKEN, { api: offline(), store: createMemoryStore() });
    expect(out).toEqual({ kind: 'offlineNoCopy' });
  });

  it('a server 404 is NOT masked by a cached copy', async () => {
    const store = createMemoryStore();
    await saveResult(store, TOKEN, makeResult(), NOW);
    const out = await runVerification(TOKEN, { api: offline(new ApiError('NOT_FOUND', 404)), store });
    expect(out).toEqual({ kind: 'error', error: 'NOT_FOUND' });
  });

  it('rejects a malformed token without calling the API', async () => {
    const api = online();
    const out = await runVerification('../etc/passwd', { api, store: createMemoryStore() });
    expect(out.kind).toBe('error');
    expect(api.verify).not.toHaveBeenCalled();
  });
});

describe('UNKNOWN token', () => {
  it('is a RED unrecognised result, not an error, and is never cached or put in history', async () => {
    const store = createMemoryStore();
    const out = await runVerification(TOKEN, { api: online(makeUnknownResult()), store, now: () => NOW });
    expect(out).toMatchObject({ kind: 'fresh', view: { indicator: 'RED', isUnrecognised: true } });
    expect(await loadResult(store, TOKEN)).toBeNull();
    expect(await loadHistory(store)).toHaveLength(0);
  });

  it('stays RED even if a bad server said GREEN for a null product', () => {
    const odd = { ...makeUnknownResult(), indicator: 'GREEN' as const };
    expect(presentResult(odd, { isCached: false, fetchedAt: NOW, now: NOW }).indicator).toBe('RED');
  });
});

describe('risk.assessed = false', () => {
  it('a not-yet-scored result is never GREEN-presented as an assessed LOW, and the flag is preserved', () => {
    const r = makeResult({ risk: { score: 0, level: 'LOW', assessed: false }, indicator: 'YELLOW' });
    const view = presentResult(r, { isCached: false, fetchedAt: NOW, now: NOW });
    expect(view.result.risk.assessed).toBe(false);
    expect(view.indicator).toBe('YELLOW');
  });
});

describe('verify passes location only when supplied', () => {
  it('forwards location to the API', async () => {
    const api = online();
    await runVerification(TOKEN, { api, store: createMemoryStore(), location: { lat: 1, lon: 2 } });
    expect(api.verify).toHaveBeenCalledWith(TOKEN, { lat: 1, lon: 2 });
  });
});
