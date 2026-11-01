import { describe, expect, it } from 'vitest';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiServiceError, HttpAiClient } from '../src/risk/aiClient';
import { AnthropicProvider, executeTool, runInvestigationAgent, type Block, type LlmProvider } from '../src/investigations/llm';
import type { Evidence } from '../src/investigations/evidence';
import { ConsoleEmailSender, ExpoPushSender } from '../src/notifications/channels';
import { RazorpayGateway, verifyWebhookSignature } from '../src/billing/razorpay';
import { DirectoryIdentityProvider } from '../src/blockchain/fabricGateway';
import { ChainError } from '../src/blockchain/gateway';
import { EnvKeySigner, signatureRef, verifySignature } from '../src/blockchain/signer';
import { buildChainCall, buildProductCall, type EventContext } from '../src/blockchain/args';
import { alertTypeFor } from '../src/risk/service';
import { silentLogger } from './doubles';

type FetchArgs = { url: string; init: RequestInit };
const fakeFetch = (status: number, body: unknown, seen: FetchArgs[] = []) =>
  (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

describe('AI service client', () => {
  it('signs the exact body with HMAC-SHA256 and a fresh timestamp', async () => {
    const seen: FetchArgs[] = [];
    const client = new HttpAiClient('http://ai:8000/', 'topsecret', fakeFetch(200, { riskScore: 1 }, seen));
    await client.score({ a: 1 });
    const { url, init } = seen[0]!;
    const headers = init.headers as Record<string, string>;
    expect(url).toBe('http://ai:8000/v1/score');
    expect(headers['X-Signature']).toBe(createHmac('sha256', 'topsecret').update(init.body as string).digest('hex'));
    expect(Math.abs(Number(headers['X-Timestamp']) - Date.now() / 1000)).toBeLessThan(5);
  });

  it('raises a typed error when the service rejects the call', async () => {
    await expect(new HttpAiClient('http://ai', 's', fakeFetch(401, {})).score({})).rejects.toBeInstanceOf(AiServiceError);
  });
});

const evidence = (): Evidence => ({
  batch: { id: 'b1', batchCode: 'SS1' }, scans: [{ id: 's1' }], events: [{ id: 'e1' }], transfers: [{ id: 't1' }],
  prediction: { id: 'p1', level: 'HIGH' }, alerts: [{ id: 'a1' }], attempts: [{ id: 'x1' }], reports: [{ id: 'r1' }], refs: new Set(),
});

describe('investigation LLM plumbing', () => {
  it('exposes only read-only retrieval tools and refuses unknown ones', () => {
    const e = evidence();
    expect(executeTool('get_batch', e)).toMatchObject({ ref: 'batch:b1' });
    expect(executeTool('get_scan_history', e)).toEqual([{ ref: 'scan:s1', id: 's1' }]);
    expect(executeTool('get_chain_history', e)).toEqual([{ ref: 'event:e1', id: 'e1' }]);
    expect(executeTool('get_ownership_history', e)).toEqual([{ ref: 'transfer:t1', id: 't1' }]);
    expect(executeTool('get_anomaly_indicators', e)).toMatchObject({ prediction: { ref: 'prediction:p1' } });
    expect(executeTool('get_rejected_operations_and_reports', e)).toMatchObject({ attempts: [{ ref: 'attempt:x1' }], reports: [{ ref: 'report:r1' }] });
    expect(executeTool('get_anomaly_indicators', { ...e, prediction: null })).toMatchObject({ prediction: null });
    expect(() => executeTool('delete_everything', e)).toThrow(/unknown tool/);
  });

  it('stops a model that never submits a report', async () => {
    const looping: LlmProvider = { name: 'loop', complete: async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'get_batch', input: {} }] }) };
    await expect(runInvestigationAgent(looping, evidence(), 'alert')).rejects.toThrow(/turn limit/);
    const chatty: LlmProvider = { name: 'chat', complete: async () => ({ content: [{ type: 'text', text: 'hello' } as Block] }) };
    await expect(runInvestigationAgent(chatty, evidence(), 'alert')).rejects.toThrow(/without submitting/);
  });

  it('rejects schema-invalid reports', async () => {
    const bad: LlmProvider = { name: 'bad', complete: async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'submit_report', input: { mainSuspiciousActivity: 'x' } }] }) };
    await expect(runInvestigationAgent(bad, evidence(), 'alert')).rejects.toThrow();
  });

  it('calls the Anthropic Messages API with the key, version header and tool definitions', async () => {
    const seen: FetchArgs[] = [];
    const provider = new AnthropicProvider('sk-test', 'claude-sonnet-5-5', fakeFetch(200, { content: [] }, seen));
    await provider.complete({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(seen[0]!.init.body as string).model).toBe('claude-sonnet-5-5');
    await expect(new AnthropicProvider('k', 'm', fakeFetch(500, {})).complete({ system: '', messages: [], tools: [] })).rejects.toThrow(/500/);
  });
});

describe('notification and billing clients', () => {
  it('posts to the Expo push service and surfaces failures', async () => {
    const seen: FetchArgs[] = [];
    await new ExpoPushSender(fakeFetch(200, {}, seen)).send({ token: 'ExponentPushToken[x]', title: 't', body: 'b', data: { a: 1 } });
    expect(JSON.parse(seen[0]!.init.body as string)).toMatchObject({ to: 'ExponentPushToken[x]', title: 't', data: { a: 1 } });
    await expect(new ExpoPushSender(fakeFetch(500, {})).send({ token: 't', title: 't', body: 'b' })).rejects.toThrow(/500/);
  });

  it('console email sender never claims delivery', async () => {
    await expect(new ConsoleEmailSender(silentLogger).send({ to: 'a@b.test', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('creates Razorpay subscriptions with basic auth and maps gateway errors', async () => {
    const seen: FetchArgs[] = [];
    const gw = new RazorpayGateway('key', 'secret', fakeFetch(200, { id: 'sub_1', short_url: 'https://rzp.io/x' }, seen));
    expect(await gw.createSubscription({ gatewayPlanId: 'plan_1', tenantId: 't1' })).toEqual({ id: 'sub_1', shortUrl: 'https://rzp.io/x' });
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('key:secret').toString('base64')}`);
    await expect(new RazorpayGateway('k', 's', fakeFetch(400, {})).createSubscription({ gatewayPlanId: 'p', tenantId: 't' })).rejects.toMatchObject({ status: 502 });
  });

  it('verifies webhook signatures in constant time and rejects missing or malformed ones', () => {
    const body = Buffer.from('{"event":"x"}');
    const good = createHmac('sha256', 'whs').update(body).digest('hex');
    expect(verifyWebhookSignature(body, good, 'whs')).toBe(true);
    expect(verifyWebhookSignature(body, undefined, 'whs')).toBe(false);
    expect(verifyWebhookSignature(body, good.slice(2), 'whs')).toBe(false);
    expect(verifyWebhookSignature(body, good, 'other')).toBe(false);
  });
});

describe('ledger identities, signer and call building', () => {
  it('reads an enrolled identity and reports a missing one as a permanent error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wallet-'));
    mkdirSync(join(dir, 'org1'));
    writeFileSync(join(dir, 'org1', 'cert.pem'), 'CERT');
    writeFileSync(join(dir, 'org1', 'key.pem'), 'KEY');
    writeFileSync(join(dir, 'org1', 'mspid'), 'SmartSeedMSP\n');
    const provider = new DirectoryIdentityProvider(dir);
    expect(await provider.get('org1')).toMatchObject({ mspId: 'SmartSeedMSP', privateKeyPem: 'KEY' });
    const err = await provider.get('org2').catch((e) => e);
    expect(err).toBeInstanceOf(ChainError);
    expect(err.retryable).toBe(false);
  });

  it('signs and verifies record hashes and builds ledger-safe references', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signer = new EnvKeySigner(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
    const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const sig = await signer.sign('abc123');
    expect(verifySignature(pub, 'abc123', sig)).toBe(true);
    expect(verifySignature(pub, 'tampered', sig)).toBe(false);
    expect(signatureRef(signer.keyId, sig)).toMatch(/^sig:[0-9a-f]{16}:[0-9a-f]{24}$/);
  });

  const ctx = (type: string, extra: Partial<EventContext['event']> = {}): EventContext => ({
    event: { id: 'e1', batch_id: 'b1', sequence: 1, event_type: type, actor_org: 'o1', counterparty_org: 'o2', quantity: 5, transfer_id: 't1', corrects_event_id: null,
      payload: { salt: 'ab', quantityCommitment: 'c'.repeat(64) }, record_hash: 'f'.repeat(64), occurred_at: new Date(), ...extra },
    batch: { id: 'b1', product_id: 'p1', manufacturer_org_id: 'o1', manufacturing_date: '2026-01-01', expiry_date: '2099-01-01' },
    transferEventId: 'te1',
  });

  it('attaches private quantity data only when enabled and refuses events without a ledger function', () => {
    expect(buildChainCall(ctx('transfer_created'), 'sig:x', false).transient).toBeUndefined();
    expect(buildChainCall(ctx('transfer_created'), 'sig:x', true).transient).toEqual({ quantity: '5', salt: 'ab' });
    expect(buildChainCall(ctx('retail_sale', { quantity: null }), 'sig:x', true).transient).toBeUndefined();
    expect(() => buildChainCall(ctx('discrepancy_recorded'), 'sig:x', false)).toThrow(/no chaincode function/);
    expect(buildChainCall(ctx('transfer_cancelled'), 'sig:x', false).fn).toBe('CancelTransfer');
    expect(buildProductCall('p1', 'o1', { name: 'x' }, 'sig:x').input).toMatchObject({ eventId: 'P-p1', ownerTenantId: 'o1' });
  });

  it('derives alert types from the strongest indicator family', () => {
    const base = { riskScore: 80, level: 'CRITICAL' as const, category: 'misc', severity: 'HIGH', confidence: 0.5, evidence: [], recommendedAction: '', modelVersion: 'v', mode: 'm', componentScores: {}, configVersion: 'c', disclaimer: '' };
    const ind = (family: string, s: number) => ({ code: 'X', family, severity: 'HIGH', normalizedSignal: s, description: 'd' });
    expect(alertTypeFor({ ...base, indicators: [ind('geo', 0.4), ind('inventory', 0.9)] })).toBe('INVENTORY_MISMATCH');
    expect(alertTypeFor({ ...base, indicators: [] })).toBe('RISK_HIGH');
    expect(alertTypeFor({ ...base, category: 'expiry', indicators: [] })).toBe('EXPIRY_RISK');
  });
});
