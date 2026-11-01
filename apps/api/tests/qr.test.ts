import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { decryptField } from '../src/lib/crypto';
import { deriveIndicator, type Verification } from '../src/passport/indicator';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, type Harness, type Party } from './helpers';

let h: Harness;
let tenantId: string;
let mfr: Party;
let d1: Party;
let batchId: string;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const call = (method: 'get' | 'post', path: string, token: string, body?: unknown) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body as object);
};

async function tokenOf(qrId: string): Promise<string> {
  const row = await h.admin.query<{ token_enc: string }>('SELECT token_enc FROM qr_codes WHERE id = $1', [qrId]);
  return decryptField(row.rows[0]?.token_enc as string, h.config.FIELD_ENCRYPTION_KEY);
}

const verify = (token: string) => request(h.app).get(`/v1/public/verify/${token}`).set('X-Device-Id', randomUUID());

async function commitAllChainRecords() {
  await h.admin.query("UPDATE blockchain_transactions SET status = 'committed', fabric_tx_id = 'tx-' || id::text, committed_at = now()");
}

beforeEach(async () => {
  await resetData(h);
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  const p = await call('post', '/products', mfr.token, { name: 'Paddy', brand: 'AgriRice', cropType: 'Rice', variety: 'R-7', category: 'certified' });
  const b = await call('post', '/batches', mfr.token, {
    productId: p.body.data.id, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Guntur', facility: 'F1', initialQuantity: 100,
  });
  batchId = b.body.data.id;
});

describe('deriveIndicator', () => {
  const clean: Verification = { digitalIdentity: 'VALID', blockchain: 'VERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' };
  it('is green only when every check is clean', () => {
    expect(deriveIndicator(clean, 'LOW', false)).toBe('GREEN');
    expect(deriveIndicator({ ...clean, blockchain: 'UNVERIFIED' }, 'LOW', false)).toBe('YELLOW');
    expect(deriveIndicator({ ...clean, blockchain: 'FAILED' }, 'LOW', false)).toBe('RED');
    expect(deriveIndicator(clean, 'LOW', true)).toBe('YELLOW');
    expect(deriveIndicator(clean, 'MEDIUM', false)).toBe('YELLOW');
    expect(deriveIndicator(clean, 'HIGH', false)).toBe('RED');
    expect(deriveIndicator({ ...clean, scanActivity: 'SUSPICIOUS' }, 'LOW', false)).toBe('YELLOW');
    expect(deriveIndicator({ ...clean, digitalIdentity: 'REVOKED' }, 'LOW', false)).toBe('RED');
    expect(deriveIndicator({ ...clean, investigation: 'CONFIRMED_COUNTERFEIT' }, 'LOW', false)).toBe('RED');
  });
});

describe('QR issuance', () => {
  it('issues one active batch QR with an unguessable token and refuses duplicates', async () => {
    const first = await call('post', `/batches/${batchId}/qr`, mfr.token);
    expect(first.status).toBe(201);
    const token = await tokenOf(first.body.data.id);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await call('post', `/batches/${batchId}/qr`, mfr.token)).body.error.code).toBe('QR_EXISTS');
    const stored = await h.admin.query('SELECT token_hash FROM qr_codes');
    expect(JSON.stringify(stored.rows)).not.toContain(token);
  });

  it('creates package QRs in ranges without exceeding the batch quantity', async () => {
    const res = await call('post', `/batches/${batchId}/packages`, mfr.token, { count: 60 });
    expect(res.body.data).toMatchObject({ firstSerial: 1, lastSerial: 60 });
    expect((await call('post', `/batches/${batchId}/packages`, mfr.token, { count: 41 })).body.error.code).toBe('EXCEEDS_BATCH_QUANTITY');
    expect((await call('post', `/batches/${batchId}/packages`, mfr.token, { count: 40 })).body.data.lastSerial).toBe(100);
  });

  it('downloads png, svg and printable label formats for active codes only', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const png = await call('get', `/qr/${qr}/download?format=png`, mfr.token);
    expect(png.headers['content-type']).toContain('image/png');
    const label = await call('get', `/qr/${qr}/download?format=label`, mfr.token);
    const svgText = Buffer.from(label.body).toString('utf8');
    expect(svgText).toContain('AgriRice');
    expect(svgText).toContain('<svg');
    await call('post', `/qr/${qr}/revoke`, mfr.token, { reason: 'Printed on wrong lot' });
    expect((await call('get', `/qr/${qr}/download?format=svg`, mfr.token)).status).toBe(409);
  });

  it('keeps other tenants and downstream orgs from managing codes', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const other = await seedManufacturer(h, await seedTenant(h));
    expect((await call('post', `/qr/${qr}/revoke`, other.token, { reason: 'not mine at all' })).status).toBe(404);
    expect((await call('post', `/qr/${qr}/revoke`, d1.token, { reason: 'not mine at all' })).status).toBe(403);
    expect((await call('get', `/qr/${qr}/download`, other.token)).status).toBe(404);
  });
});

describe('public verification', () => {
  it('never returns green before the blockchain confirms the history', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const res = await verify(await tokenOf(qr));
    expect(res.status).toBe(200);
    expect(res.body.data.verification).toMatchObject({ digitalIdentity: 'VALID', blockchain: 'UNVERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' });
    expect(res.body.data.indicator).toBe('YELLOW');
    expect(res.body.data.warnings).toContain('CHAIN_NOT_YET_CONFIRMED');
  });

  it('is green once all chain records are committed and nothing suspicious exists', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    await commitAllChainRecords();
    const res = await verify(await tokenOf(qr));
    expect(res.body.data.verification.blockchain).toBe('VERIFIED');
    expect(res.body.data.indicator).toBe('GREEN');
    expect(res.body.data.manufacturer.name).toBeTruthy();
  });

  it('turns red when the ledger verification flags a mismatch or a chain submission failed', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    await commitAllChainRecords();
    await h.admin.query("UPDATE seed_batches SET ledger_status = 'mismatch'");
    const res = await verify(await tokenOf(qr));
    expect(res.body.data.verification.blockchain).toBe('FAILED');
    expect(res.body.data.indicator).toBe('RED');
  });

  it('flags revoked and superseded codes and unknown tokens', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const oldToken = await tokenOf(qr);
    const fresh = await call('post', `/qr/${qr}/regenerate`, mfr.token, { reason: 'Label damaged in print' });
    const oldRes = await verify(oldToken);
    expect(oldRes.body.data.verification.digitalIdentity).toBe('REVOKED');
    expect(oldRes.body.data.warnings).toContain('QR_SUPERSEDED');
    expect(oldRes.body.data.indicator).toBe('RED');
    expect((await verify(await tokenOf(fresh.body.data.id))).body.data.verification.digitalIdentity).toBe('VALID');
    const unknown = await verify('A'.repeat(32));
    expect(unknown.body.data).toMatchObject({ indicator: 'RED', verification: { digitalIdentity: 'UNKNOWN' } });
  });

  it('marks expired batches and never exposes tenant, org ids or quantities', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    await commitAllChainRecords();
    await h.admin.query("UPDATE seed_batches SET manufacturing_date = '2020-01-01', expiry_date = '2021-01-01'");
    const res = await verify(await tokenOf(qr));
    expect(res.body.data.batch.expired).toBe(true);
    expect(res.body.data.indicator).toBe('YELLOW');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(tenantId);
    expect(text).not.toContain(mfr.orgId);
    expect(text).not.toContain('initialQuantity');
  });

  it('logs each scan with rounded location and hashed identifiers, and queues scoring once', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const token = await tokenOf(qr);
    const device = randomUUID();
    await request(h.app).get(`/v1/public/verify/${token}?lat=17.385044&lon=78.486671`).set('X-Device-Id', device);
    await request(h.app).get(`/v1/public/verify/${token}?lat=17.385044&lon=78.486671`).set('X-Device-Id', device);
    const scans = await call('get', `/qr/${qr}/scans`, mfr.token);
    expect(scans.body.data).toHaveLength(2);
    expect(Number(scans.body.data[0].lat)).toBe(17.39);
    const raw = await h.admin.query('SELECT device_hash, ip_hash FROM qr_scans LIMIT 1');
    expect(raw.rows[0].device_hash).not.toContain(device);
    const jobs = await h.admin.query("SELECT count(*)::int AS n FROM jobs WHERE type = 'score_batch'");
    expect(jobs.rows[0].n).toBe(1);
  });
});

describe('farmer reports and devices', () => {
  it('turns a report into one deduplicated alert for human review', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const token = await tokenOf(qr);
    for (let i = 0; i < 2; i++) {
      const res = await request(h.app).post('/v1/public/reports').send({ token, description: 'Seeds look dyed', region: 'Telangana' });
      expect(res.status).toBe(201);
    }
    const alerts = await h.admin.query('SELECT alert_type, status FROM alerts');
    expect(alerts.rows).toEqual([{ alert_type: 'FARMER_REPORT', status: 'open' }]);
    expect((await h.admin.query('SELECT count(*)::int AS n FROM counterfeit_reports')).rows[0].n).toBe(2);
    expect((await request(h.app).post('/v1/public/reports').send({ token: 'nope' })).status).toBe(404);
  });

  it('registers pseudonymous devices and validates languages', async () => {
    const deviceId = randomUUID();
    const ok = await request(h.app).post('/v1/public/devices').send({ deviceId, language: 'te', pushToken: 'ExponentPushToken[abc]' });
    expect(ok.status).toBe(201);
    const row = await h.admin.query('SELECT device_hash, push_token_enc, language FROM public_devices');
    expect(row.rows[0].language).toBe('te');
    expect(row.rows[0].device_hash).not.toContain(deviceId);
    expect(row.rows[0].push_token_enc).not.toContain('ExponentPushToken');
    expect((await request(h.app).post('/v1/public/devices').send({ deviceId, language: 'fr' })).status).toBe(400);
    expect((await request(h.app).get(`/v1/public/notifications?deviceId=${deviceId}`)).body.data).toEqual([]);
  });
});

describe('full digital product passport', () => {
  it('shows stakeholders the journey with chain references, scoped to what they can see', async () => {
    const full = await call('get', `/batches/${batchId}/passport`, mfr.token);
    expect(full.status).toBe(200);
    expect(full.body.data.journey[0]).toMatchObject({ eventType: 'batch_registered', chainStatus: 'pending' });
    expect((await call('get', `/batches/${batchId}/passport`, d1.token)).status).toBe(404);
  });
});
