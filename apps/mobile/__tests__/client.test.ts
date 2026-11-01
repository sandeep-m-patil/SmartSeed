import { createApiClient } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { TOKEN, envelope, jsonResponse, makeResult, makeUnknownResult } from './fixtures';

const noSleep = jest.fn().mockResolvedValue(undefined);

function client(fetchImpl: jest.Mock, extra: { retries?: number; timeoutMs?: number } = {}) {
  return createApiClient({ baseUrl: 'https://api.test/', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: noSleep, ...extra });
}

async function kindOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof ApiError ? e.kind : `non-ApiError:${String(e)}`;
  }
}

beforeEach(() => noSleep.mockClear());

describe('API client', () => {
  it('GETs /v1/public/verify/{token} and returns parsed data', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(makeResult())));
    const result = await client(f).verify(TOKEN);
    expect(result.batch?.code).toBe('B-2026-001');
    expect(f.mock.calls[0]?.[0]).toBe(`https://api.test/v1/public/verify/${TOKEN}`);
  });

  it('encodes the token in the path', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(makeResult())));
    await client(f).verify('a/b?c');
    expect(f.mock.calls[0]?.[0]).toBe('https://api.test/v1/public/verify/a%2Fb%3Fc');
  });

  it.each([
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [400, 'BAD_REQUEST'],
    [422, 'BAD_REQUEST'],
    [500, 'SERVER'],
    [503, 'SERVER'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const f = jest.fn().mockResolvedValue(jsonResponse(status, { data: null, error: { code: 'X' } }));
    expect(await kindOf(client(f, { retries: 0 }).verify(TOKEN))).toBe(kind);
  });

  it('exposes Retry-After (capped) on 429 and does not retry it', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(429, {}, { 'Retry-After': '9999' }));
    const err = await client(f).verify(TOKEN).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).retryAfterSeconds).toBe(60);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps fetch rejection to NETWORK and retries with backoff', async () => {
    const f = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    expect(await kindOf(client(f, { retries: 2 }).verify(TOKEN))).toBe('NETWORK');
    expect(f).toHaveBeenCalledTimes(3);
    expect(noSleep).toHaveBeenCalledTimes(2);
  });

  it('recovers when a retry succeeds', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, envelope(makeResult())));
    expect((await client(f).verify(TOKEN)).product?.name).toBe('Hybrid Cotton BG-II');
  });

  it('does not retry 404', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(404, {}));
    await kindOf(client(f).verify(TOKEN));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('maps a hung request to TIMEOUT via abort', async () => {
    const f = jest.fn((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
    );
    expect(await kindOf(client(f as unknown as jest.Mock, { retries: 0, timeoutMs: 20 }).verify(TOKEN))).toBe('TIMEOUT');
  });

  it('rejects a payload with an unknown enum value (fail closed)', async () => {
    const bad = makeResult();
    (bad.verification as unknown as Record<string, string>).blockchain = 'MAYBE';
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(bad)));
    expect(await kindOf(client(f, { retries: 0 }).verify(TOKEN))).toBe('INVALID_RESPONSE');
  });

  it('rejects non-JSON bodies and envelopes carrying an error', async () => {
    const html = jest.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await kindOf(client(html, { retries: 0 }).verify(TOKEN))).toBe('INVALID_RESPONSE');
    const withError = jest.fn().mockResolvedValue(jsonResponse(200, { data: makeResult(), error: { code: 'E' } }));
    expect(await kindOf(client(withError, { retries: 0 }).verify(TOKEN))).toBe('INVALID_RESPONSE');
  });

  it('POST report sends the body and is never retried', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(500, {}));
    expect(await kindOf(client(f).report({ token: TOKEN, region: 'Guntur' }))).toBe('SERVER');
    expect(f).toHaveBeenCalledTimes(1);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, region: 'Guntur' });
  });

  it('registers a device and lists notifications', async () => {
    const f = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, envelope({ ok: true })))
      .mockResolvedValueOnce(jsonResponse(200, envelope([{ id: '1', title: 'T', body: 'B', createdAt: '2026-01-01' }])));
    const c = client(f);
    await c.registerDevice({ deviceId: 'd1', language: 'te' });
    expect(await c.notifications('d 1')).toHaveLength(1);
    expect(f.mock.calls[1]?.[0]).toBe('https://api.test/v1/public/notifications?deviceId=d%201');
  });

  it('parses an UNKNOWN-token response (200 with nulls, RED, QR_UNKNOWN) as a result, not an error', async () => {
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(makeUnknownResult())));
    const r = await client(f).verify(TOKEN);
    expect(r.product).toBeNull();
    expect(r.batch).toBeNull();
    expect(r.indicator).toBe('RED');
    expect(r.warnings).toEqual(['QR_UNKNOWN']);
    expect(r.risk.assessed).toBe(false);
  });

  it('accepts package, null certification validTo, and ignores unknown extra keys', async () => {
    const data = { ...makeResult(), package: { serialNo: 'P-9' }, extraTopLevel: 1, certifications: [{ type: 'T', issuer: 'I', number: 'N', validTo: null, x: 1 }] };
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(data)));
    const r = await client(f).verify(TOKEN);
    expect(r.package).toEqual({ serialNo: 'P-9' });
    expect(r.certifications[0]?.validTo).toBeNull();
    expect('extraTopLevel' in r).toBe(false);
  });

  it('keeps enums strict but tolerates future journey/warning codes', async () => {
    const data = { ...makeResult(), warnings: ['SOME_FUTURE_CODE'], journey: [{ step: 'RECALLED', orgType: 'courier', at: 'x', status: 'PENDING' }] };
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(data)));
    expect((await client(f).verify(TOKEN)).warnings).toEqual(['SOME_FUTURE_CODE']);
  });

  it('requires risk.assessed', async () => {
    const data = makeResult();
    delete (data.risk as unknown as Record<string, unknown>).assessed;
    const f = jest.fn().mockResolvedValue(jsonResponse(200, envelope(data)));
    expect(await kindOf(client(f, { retries: 0 }).verify(TOKEN))).toBe('INVALID_RESPONSE');
  });

  it('sends X-Device-Id on verify and report, and lat/lon only when given', async () => {
    const f = jest.fn().mockImplementation(async () => jsonResponse(200, envelope(makeResult())));
    const c = createApiClient({ baseUrl: 'https://api.test', fetchImpl: f as unknown as typeof fetch, sleep: noSleep, getDeviceId: async () => 'dev-uuid' });
    await c.verify(TOKEN);
    await c.verify(TOKEN, { lat: 16.5, lon: 80.6 });
    await c.report({ token: TOKEN });
    expect(f.mock.calls[0]?.[0]).not.toContain('lat=');
    expect(f.mock.calls[1]?.[0]).toContain('?lat=16.5&lon=80.6');
    for (const call of f.mock.calls) expect((call[1] as RequestInit).headers).toMatchObject({ 'X-Device-Id': 'dev-uuid' });
  });

  it('tolerates notification fields id,type,title,body,createdAt,readAt', async () => {
    const f = jest.fn().mockResolvedValue(
      jsonResponse(200, envelope([{ id: '1', type: 'ALERT', title: 'T', body: 'B', createdAt: '2026-01-01', readAt: null, extra: true }])),
    );
    const list = await client(f).notifications('d');
    expect(list[0]).toMatchObject({ id: '1', type: 'ALERT', readAt: null });
  });
});
