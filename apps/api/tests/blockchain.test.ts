import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { processOutbox, type OutboxDeps } from '../src/blockchain/outbox';
import { verifyBatchLedger } from '../src/blockchain/verifier';
import { verifySignature } from '../src/blockchain/signer';
import { classifyFabricError } from '../src/blockchain/fabricGateway';
import { decryptField } from '../src/lib/crypto';
import { RecordingGateway, rejectedError, silentLogger, testSigner, transientError } from './doubles';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, type Harness, type Party } from './helpers';

let h: Harness;
let gw: RecordingGateway;
let deps: OutboxDeps;
let keys: ReturnType<typeof testSigner>;
let tenantId: string;
let mfr: Party;
let d1: Party;
let batchId: string;

beforeAll(async () => {
  h = await createHarness();
  keys = testSigner();
});
afterAll(async () => { await h.close(); });

const call = (method: 'get' | 'post', path: string, token: string, body?: unknown, key?: string) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return body === undefined ? req : req.send(body as object);
};

const pump = async (times = 6) => {
  for (let i = 0; i < times; i++) await processOutbox(deps);
};

const statuses = async () =>
  (await h.admin.query(
    `SELECT e.event_type AS type, t.status, t.fabric_tx_id AS tx FROM blockchain_transactions t
     JOIN supply_chain_events e ON e.id = t.event_id ORDER BY e.sequence`)).rows;

beforeEach(async () => {
  await resetData(h);
  gw = new RecordingGateway();
  deps = { db: h.db, gateway: gw, signer: keys.signer, logger: silentLogger, usePrivateData: false };
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  const p = await call('post', '/products', mfr.token, { name: 'Wheat', brand: 'GoldEar', cropType: 'Wheat', variety: 'W-1', category: 'certified' });
  const b = await call('post', '/batches', mfr.token, {
    productId: p.body.data.id, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Pune', facility: 'F1', initialQuantity: 1000,
  });
  batchId = b.body.data.id;
});

async function transferAndDispatch() {
  const t = await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 400 }, randomUUID());
  const id = t.body.data.id as string;
  await call('post', `/transfers/${id}/dispatch`, mfr.token, { sourceLocation: 'Pune', destinationLocation: 'Nashik' });
  await call('post', `/transfers/${id}/accept`, d1.token, {});
  return id;
}

describe('outbox processing', () => {
  it('commits events in database order and registers the product before its first batch', async () => {
    await transferAndDispatch();
    await pump();
    expect(gw.calls.map((c) => c.fn)).toEqual(['RegisterProduct', 'RegisterBatch', 'TransferBatch', 'RecordShipment', 'AcceptBatch']);
    const rows = await statuses();
    expect(rows.every((r) => r.status === 'committed' && r.tx)).toBe(true);
    const accept = gw.calls.find((c) => c.fn === 'AcceptBatch');
    expect(accept?.orgId).toBe(d1.orgId);
    expect(accept?.input.transferEventId).toBe(gw.calls.find((c) => c.fn === 'TransferBatch')?.input.eventId);
  });

  it('stores a verifiable application signature for each committed record', async () => {
    await pump();
    const row = (await h.admin.query(
      `SELECT e.record_hash, t.signature FROM blockchain_transactions t JOIN supply_chain_events e ON e.id = t.event_id`)).rows[0];
    expect(verifySignature(keys.publicKeyPem, row.record_hash, row.signature)).toBe(true);
    expect(gw.calls.find((c) => c.fn === 'RegisterBatch')?.input.signatureRef).toMatch(/^sig:[0-9a-f]{16}:[0-9a-f]{24}$/);
  });

  it('keeps public verification non-green until commit, then green', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const enc = (await h.admin.query('SELECT token_enc FROM qr_codes WHERE id = $1', [qr])).rows[0].token_enc;
    const token = decryptField(enc, h.config.FIELD_ENCRYPTION_KEY);
    expect((await request(h.app).get(`/v1/public/verify/${token}`)).body.data.indicator).toBe('YELLOW');
    await pump();
    const after = await request(h.app).get(`/v1/public/verify/${token}`);
    expect(after.body.data.verification.blockchain).toBe('VERIFIED');
    expect(after.body.data.indicator).toBe('GREEN');
  });

  it('retries transient failures with backoff and never marks them committed', async () => {
    gw.failWhen = () => transientError();
    await processOutbox(deps);
    let row = (await h.admin.query('SELECT status, attempts, next_attempt_at > now() AS delayed, last_error FROM blockchain_transactions')).rows[0];
    expect(row).toMatchObject({ status: 'pending', attempts: 1, delayed: true });
    expect(row.last_error).toContain('unavailable');
    await h.admin.query('UPDATE blockchain_transactions SET next_attempt_at = now()');
    gw.failWhen = () => null;
    await pump();
    row = (await h.admin.query('SELECT status FROM blockchain_transactions')).rows[0];
    expect(row.status).toBe('committed');
  });

  it('fails permanently on chaincode rejection and blocks later events of that batch', async () => {
    await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 10 }, randomUUID());
    gw.failWhen = (req) => (req.fn === 'RegisterBatch' ? rejectedError() : null);
    await pump();
    const rows = await statuses();
    expect(rows.map((r) => r.status)).toEqual(['failed', 'pending']);
    expect(gw.calls.map((c) => c.fn)).not.toContain('TransferBatch');
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const token = decryptField((await h.admin.query('SELECT token_enc FROM qr_codes WHERE id = $1', [qr])).rows[0].token_enc, h.config.FIELD_ENCRYPTION_KEY);
    const verify = await request(h.app).get(`/v1/public/verify/${token}`);
    expect(verify.body.data.verification.blockchain).toBe('FAILED');
    expect(verify.body.data.indicator).toBe('RED');
  });

  it('refuses to commit a record whose database row was altered after it was written', async () => {
    await h.admin.query('ALTER TABLE supply_chain_events DISABLE TRIGGER supply_chain_events_append_only');
    await h.admin.query("UPDATE supply_chain_events SET quantity = 999999");
    await h.admin.query('ALTER TABLE supply_chain_events ENABLE TRIGGER supply_chain_events_append_only');
    await pump();
    const row = (await h.admin.query('SELECT status, last_error FROM blockchain_transactions')).rows[0];
    expect(row.status).toBe('failed');
    expect(row.last_error).toContain('hash mismatch');
    expect(gw.calls).toHaveLength(0);
  });

  it('treats an already-committed ledger answer as success (idempotent resubmission)', async () => {
    gw.alreadyCommitted = true;
    await pump();
    expect((await statuses())[0]?.status).toBe('committed');
  });

  it('does not create ledger work for off-chain-only events', async () => {
    const t = await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 100 }, randomUUID());
    await call('post', `/transfers/${t.body.data.id}/dispatch`, mfr.token, { sourceLocation: 'Pune', destinationLocation: 'Nashik' });
    await call('post', `/transfers/${t.body.data.id}/accept`, d1.token, { receivedQuantity: 90 });
    const events = (await h.admin.query('SELECT count(*)::int AS n FROM supply_chain_events WHERE event_type = $1', ['discrepancy_recorded'])).rows[0].n;
    const outbox = (await h.admin.query("SELECT count(*)::int AS n FROM blockchain_transactions t JOIN supply_chain_events e ON e.id = t.event_id WHERE e.event_type = 'discrepancy_recorded'")).rows[0].n;
    expect([events, outbox]).toEqual([1, 0]);
  });
});

describe('ledger verification', () => {
  it('marks a batch verified when database and ledger hashes agree', async () => {
    await transferAndDispatch();
    await pump();
    const result = await verifyBatchLedger(h.db, gw, batchId);
    expect(result).toMatchObject({ status: 'verified', mismatches: [] });
    expect((await h.admin.query('SELECT ledger_status FROM seed_batches')).rows[0].ledger_status).toBe('verified');
  });

  it('flags a ledger hash mismatch, marks the batch and raises a critical alert', async () => {
    await pump();
    gw.hashMatches = false;
    const result = await verifyBatchLedger(h.db, gw, batchId);
    expect(result.status).toBe('mismatch');
    expect((await h.admin.query('SELECT ledger_status FROM seed_batches')).rows[0].ledger_status).toBe('mismatch');
    const alerts = (await h.admin.query('SELECT alert_type, severity FROM alerts')).rows;
    expect(alerts).toEqual([{ alert_type: 'LEDGER_MISMATCH', severity: 'CRITICAL' }]);
  });

  it('detects database tampering after commit even if the ledger still holds the original hash', async () => {
    await pump();
    await h.admin.query('ALTER TABLE supply_chain_events DISABLE TRIGGER supply_chain_events_append_only');
    await h.admin.query("UPDATE supply_chain_events SET payload = payload || '{\"x\":1}'::jsonb");
    await h.admin.query('ALTER TABLE supply_chain_events ENABLE TRIGGER supply_chain_events_append_only');
    const result = await verifyBatchLedger(h.db, gw, batchId);
    expect(result.mismatches[0]?.reason).toBe('database_hash');
  });

  it('reports incomplete (not verified) while records are still pending', async () => {
    expect((await verifyBatchLedger(h.db, gw, batchId)).status).toBe('incomplete');
  });
});

describe('fabric error classification', () => {
  it('retries infrastructure failures and MVCC conflicts but not chaincode rejections', () => {
    expect(classifyFabricError({ code: 14, message: 'unavailable' }).retryable).toBe(true);
    expect(classifyFabricError({ code: 4, message: 'deadline' }).retryable).toBe(true);
    expect(classifyFabricError({ status: { code: 11 }, message: 'mvcc' }).retryable).toBe(true);
    expect(classifyFabricError({ code: 10, message: 'NOT_OWNER' }).retryable).toBe(false);
    expect(classifyFabricError(new Error('boom')).retryable).toBe(false);
  });
});
