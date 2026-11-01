import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import {
  createHarness, resetData, seedManufacturer, seedPartner, seedTenant, seedUser, tokenFor, TEST_PASSWORD,
  type Harness, type Party,
} from './helpers';

let h: Harness;
let tenantId: string;
let mfr: Party;
let d1: Party;
let d2: Party;
let wh: Party;
let rt: Party;
let productId: string;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

const call = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: unknown, key?: string) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return body === undefined ? req : req.send(body as object);
};

const newBatch = async (quantity = 10_000, dates: { mfg?: string; exp?: string } = {}, owner: Party = mfr, product = productId) => {
  const res = await call('post', '/batches', owner.token, {
    productId: product, manufacturingDate: dates.mfg ?? '2026-01-01', expiryDate: dates.exp ?? '2099-01-01',
    productionLocation: 'Hyderabad', facility: 'Plant 1', initialQuantity: quantity,
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; batchCode: string };
};

const transfer = (from: Party, batchId: string, to: Party, quantity: number, key: string = randomUUID()) =>
  call('post', '/transfers', from.token, { batchId, toOrgId: to.orgId, quantity }, key);

const dispatchBody = { sourceLocation: 'Hyderabad', destinationLocation: 'Warangal', carrier: 'FastCargo' };

async function moveFully(from: Party, to: Party, batchId: string, quantity: number, received?: number) {
  const t = await transfer(from, batchId, to, quantity);
  expect(t.status).toBe(201);
  const id = t.body.data.id as string;
  expect((await call('post', `/transfers/${id}/dispatch`, from.token, dispatchBody)).status).toBe(200);
  const acc = await call('post', `/transfers/${id}/accept`, to.token, received ? { receivedQuantity: received } : {});
  expect(acc.status).toBe(200);
  return id;
}

const qty = async (p: Party, batchId: string) => {
  const inv = await call('get', '/inventory', p.token);
  const row = inv.body.data.find((r: { batchId: string }) => r.batchId === batchId);
  return row ? { quantity: row.quantity as number, reserved: row.reserved as number, available: row.available as number } : null;
};

beforeEach(async () => {
  await resetData(h);
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  d2 = await seedPartner(h, tenantId, 'distributor');
  wh = await seedPartner(h, tenantId, 'wholesaler');
  rt = await seedPartner(h, tenantId, 'retailer');
  const p = await call('post', '/products', mfr.token, {
    name: 'Hybrid Maize', brand: 'GreenGold', cropType: 'Maize', variety: 'GG-101', category: 'hybrid',
    certifications: [{ type: 'ISTA', issuer: 'Seed Cert Agency', number: 'C-1' }],
  });
  expect(p.status).toBe(201);
  productId = p.body.data.id;
});

describe('product and batch registration', () => {
  it('creates a batch with a generated code, opening inventory, ledger entry, event and pending chain record', async () => {
    const batch = await newBatch(10_000);
    expect(batch.batchCode).toMatch(/^SS2026-[0-9A-F]{8}$/);
    expect(await qty(mfr, batch.id)).toEqual({ quantity: 10_000, reserved: 0, available: 10_000 });

    const timeline = await call('get', `/batches/${batch.id}/timeline`, mfr.token);
    expect(timeline.body.data).toHaveLength(1);
    expect(timeline.body.data[0]).toMatchObject({ eventType: 'batch_registered', sequence: 1, chainStatus: 'pending', chainTxId: null });
    const mv = await call('get', `/inventory/${batch.id}/movements`, mfr.token);
    expect(mv.body.data).toMatchObject([{ delta: 10_000, balanceAfter: 10_000, reason: 'initial' }]);
  });

  it('rejects invalid batches and duplicate products', async () => {
    const bad = await call('post', '/batches', mfr.token, {
      productId, manufacturingDate: '2026-05-01', expiryDate: '2026-04-01', productionLocation: 'X1', facility: 'Y1', initialQuantity: 5,
    });
    expect(bad.status).toBe(400);
    const dup = await call('post', '/products', mfr.token, { name: 'Hybrid Maize', brand: 'GreenGold', cropType: 'Maize', variety: 'GG-101', category: 'hybrid' });
    expect(dup.status).toBe(409);
  });
});

describe('inventory and transfers', () => {
  it('splits 10,000 into 5,000 + 3,000 and keeps 2,000, refusing anything beyond', async () => {
    const batch = await newBatch(10_000);
    expect((await transfer(mfr, batch.id, d1, 5_000)).status).toBe(201);
    expect((await transfer(mfr, batch.id, d2, 3_000)).status).toBe(201);
    expect(await qty(mfr, batch.id)).toEqual({ quantity: 10_000, reserved: 8_000, available: 2_000 });

    const over = await transfer(mfr, batch.id, d1, 2_001);
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    expect((await transfer(mfr, batch.id, d1, 2_000)).status).toBe(201);
  });

  it('serialises concurrent transfers so stock is never oversold', async () => {
    const batch = await newBatch(10_000);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => transfer(mfr, batch.id, d1, 3_000)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409]);
    expect((await qty(mfr, batch.id))?.available).toBe(1_000);
  });

  it('runs the whole journey manufacturer -> distributor -> wholesaler -> retailer -> sale', async () => {
    const batch = await newBatch(10_000);
    await moveFully(mfr, d1, batch.id, 5_000);
    await moveFully(d1, wh, batch.id, 2_000);
    await moveFully(wh, rt, batch.id, 500);
    const sale = await call('post', '/sales', rt.token, { batchId: batch.id, quantity: 120 }, randomUUID());
    expect(sale.status).toBe(201);
    expect(sale.body.data).toMatchObject({ sold: 120, remaining: 380 });

    expect(await qty(mfr, batch.id)).toMatchObject({ quantity: 5_000, reserved: 0 });
    expect(await qty(d1, batch.id)).toMatchObject({ quantity: 3_000 });
    expect(await qty(wh, batch.id)).toMatchObject({ quantity: 1_500 });
    expect(await qty(rt, batch.id)).toMatchObject({ quantity: 380 });

    const total = await h.admin.query('SELECT SUM(quantity)::int AS q FROM batch_holdings WHERE batch_id = $1', [batch.id]);
    expect(total.rows[0].q + 120).toBe(10_000);

    const events = (await call('get', `/batches/${batch.id}/timeline`, mfr.token)).body.data;
    expect(events.map((e: { sequence: number }) => e.sequence)).toEqual(events.map((_: unknown, i: number) => i + 1));
    expect(events.at(-1).eventType).toBe('retail_sale');
    expect(events.every((e: { chainStatus: string }) => e.chainStatus === 'pending')).toBe(true);
    const ledger = await h.admin.query('SELECT bool_and(balance_after >= 0) AS ok FROM inventory_movements WHERE batch_id = $1', [batch.id]);
    expect(ledger.rows[0].ok).toBe(true);
  });

  it('treats repeated Idempotency-Keys as the same transfer', async () => {
    const batch = await newBatch(1_000);
    const key = 'idem-key-12345';
    const first = await transfer(mfr, batch.id, d1, 400, key);
    const again = await transfer(mfr, batch.id, d1, 400, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect(again.body.meta.replayed).toBe(true);
    expect((await qty(mfr, batch.id))?.reserved).toBe(400);
    expect((await transfer(mfr, batch.id, d1, 500, key)).body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await call('post', '/transfers', mfr.token, { batchId: batch.id, toOrgId: d1.orgId, quantity: 1 })).status).toBe(400);
  });

  it('records receipt variance as a discrepancy and moves only what arrived', async () => {
    const batch = await newBatch(1_000);
    await moveFully(mfr, d1, batch.id, 100, 90);
    expect(await qty(mfr, batch.id)).toMatchObject({ quantity: 910, reserved: 0 });
    expect(await qty(d1, batch.id)).toMatchObject({ quantity: 90 });
    const types = (await call('get', `/batches/${batch.id}/timeline`, mfr.token)).body.data.map((e: { eventType: string }) => e.eventType);
    expect(types).toContain('discrepancy_recorded');
  });

  it('releases reserved stock on reject and cancel', async () => {
    const batch = await newBatch(1_000);
    const t1 = (await transfer(mfr, batch.id, d1, 300)).body.data.id;
    await call('post', `/transfers/${t1}/dispatch`, mfr.token, dispatchBody);
    const rej = await call('post', `/transfers/${t1}/reject`, d1.token, { reason: 'Packets damaged' });
    expect(rej.body.data.status).toBe('rejected');
    const t2 = (await transfer(mfr, batch.id, d1, 200)).body.data.id;
    expect((await call('post', `/transfers/${t2}/cancel`, mfr.token)).body.data.status).toBe('cancelled');
    expect(await qty(mfr, batch.id)).toEqual({ quantity: 1_000, reserved: 0, available: 1_000 });
  });

  it('enforces the transfer state machine', async () => {
    const batch = await newBatch(1_000);
    const id = (await transfer(mfr, batch.id, d1, 100)).body.data.id;
    expect((await call('post', `/transfers/${id}/accept`, d1.token, {})).body.error.code).toBe('INVALID_STATE');
    await call('post', `/transfers/${id}/dispatch`, mfr.token, dispatchBody);
    expect((await call('post', `/transfers/${id}/dispatch`, mfr.token, dispatchBody)).status).toBe(409);
    expect((await call('post', `/transfers/${id}/transit`, mfr.token)).body.data.status).toBe('in_transit');
    await call('post', `/transfers/${id}/accept`, d1.token, {});
    expect((await call('post', `/transfers/${id}/cancel`, mfr.token)).status).toBe(409);
    expect((await call('post', `/transfers/${id}/accept`, d1.token, {})).status).toBe(409);
  });
});

describe('validation and authorization', () => {
  it('blocks expired batches and logs the attempt', async () => {
    const batch = await newBatch(500, { mfg: '2020-01-01', exp: '2021-01-01' });
    const res = await transfer(mfr, batch.id, d1, 10);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BATCH_EXPIRED');
    const attempts = await h.admin.query('SELECT reason, kind FROM blocked_attempts WHERE batch_id = $1', [batch.id]);
    expect(attempts.rows).toEqual([{ reason: 'BATCH_EXPIRED', kind: 'transfer_create' }]);
  });

  it('only lets the designated receiver accept and only the sender dispatch', async () => {
    const batch = await newBatch(1_000);
    const id = (await transfer(mfr, batch.id, d1, 100)).body.data.id;
    expect((await call('post', `/transfers/${id}/dispatch`, d1.token, dispatchBody)).status).toBe(403);
    await call('post', `/transfers/${id}/dispatch`, mfr.token, dispatchBody);
    expect((await call('post', `/transfers/${id}/accept`, mfr.token, {})).status).toBe(403);
    expect((await call('post', `/transfers/${id}/accept`, d2.token, {})).status).toBe(404);
    expect((await call('get', `/transfers/${id}`, d2.token)).status).toBe(404);
    expect((await call('post', `/transfers/${id}/accept`, d1.token, {})).status).toBe(200);
  });

  it('rejects invalid routes, unknown recipients and senders without stock', async () => {
    const batch = await newBatch(1_000);
    const skip = await transfer(mfr, batch.id, rt, 10);
    expect(skip.body.error.code).toBe('INVALID_RECIPIENT');
    const stranger = await call('post', '/transfers', mfr.token, { batchId: batch.id, toOrgId: randomUUID(), quantity: 5 }, randomUUID());
    expect(stranger.body.error.code).toBe('INVALID_RECIPIENT');
    expect((await transfer(d1, batch.id, wh, 5)).status).toBe(404);
    expect((await call('post', '/transfers', rt.token, { batchId: batch.id, toOrgId: d1.orgId, quantity: 1 }, randomUUID())).status).toBe(403);
  });

  it('prevents overselling at retail and unauthorised sales', async () => {
    const batch = await newBatch(1_000);
    await moveFully(mfr, d1, batch.id, 500);
    await moveFully(d1, rt, batch.id, 100);
    const over = await call('post', '/sales', rt.token, { batchId: batch.id, quantity: 101 }, randomUUID());
    expect(over.body.error.code).toBe('INSUFFICIENT_INVENTORY');
    const key = randomUUID();
    await call('post', '/sales', rt.token, { batchId: batch.id, quantity: 40 }, key);
    const replay = await call('post', '/sales', rt.token, { batchId: batch.id, quantity: 40 }, key);
    expect(replay.body.meta.replayed).toBe(true);
    expect((await qty(rt, batch.id))?.quantity).toBe(60);
    expect((await call('post', '/sales', d1.token, { batchId: batch.id, quantity: 1 }, randomUUID())).status).toBe(403);
  });
});

describe('tenant and organization isolation', () => {
  it('keeps one tenant from reading or using another tenants catalogue', async () => {
    const batch = await newBatch(100);
    const otherTenant = await seedTenant(h);
    const other = await seedManufacturer(h, otherTenant);
    expect((await call('get', '/batches', other.token)).body.data).toEqual([]);
    expect((await call('get', '/products', other.token)).body.data).toEqual([]);
    expect((await call('get', `/batches/${batch.id}`, other.token)).status).toBe(404);
    const steal = await call('post', '/batches', other.token, {
      productId, manufacturingDate: '2026-01-01', expiryDate: '2027-01-01', productionLocation: 'Pune', facility: 'P2', initialQuantity: 10,
    });
    expect(steal.status).toBe(404);
  });

  it('shows downstream organizations only batches they hold or are party to', async () => {
    const a = await newBatch(100);
    const b = await newBatch(100);
    expect((await call('get', '/batches', d1.token)).body.data).toEqual([]);
    await transfer(mfr, a.id, d1, 10);
    const visible = (await call('get', '/batches', d1.token)).body.data.map((x: { id: string }) => x.id);
    expect(visible).toEqual([a.id]);
    expect(visible).not.toContain(b.id);
    const rows = await h.db.withActor({ tenantId: null, orgId: d2.orgId }, async (tx) => (await tx.query('SELECT id FROM batch_holdings')).rows);
    expect(rows).toHaveLength(0);
    const scoped = await h.db.withActor({ tenantId: null, orgId: d1.orgId }, async (tx) => (await tx.query('SELECT org_id FROM batch_holdings')).rows);
    expect(scoped.every((r: { org_id: string }) => r.org_id === d1.orgId)).toBe(true);
  });

  it('does not let a partner organization of tenant A see organizations of tenant B', async () => {
    const otherTenant = await seedTenant(h);
    const foreign = await seedPartner(h, otherTenant, 'distributor');
    const orgs = (await call('get', '/organizations', d1.token)).body.data.map((o: { id: string }) => o.id);
    expect(orgs).not.toContain(foreign.orgId);
    expect(orgs).toContain(d2.orgId);
  });
});

describe('organization onboarding', () => {
  it('lets a company admin create a partner organization whose user can sign in', async () => {
    const admin = await seedUser(h, { role: 'company_admin', tenantId });
    const token = await tokenFor(h, admin.id, tenantId, ['company_admin']);
    const body = {
      type: 'retailer', legalName: 'Kisan Seeds Store', registrationNo: 'GST-29ABCDE1234F1Z5',
      adminName: 'Ravi Kumar', adminEmail: 'ravi@kisan.test', adminPassword: TEST_PASSWORD,
    };
    const created = await call('post', '/organizations', token, body);
    expect(created.status).toBe(201);
    expect((await call('post', '/organizations', token, { ...body, adminEmail: 'x@kisan.test' })).body.error.code).toBe('ORG_EXISTS');
    const login = await request(h.app).post('/v1/auth/login').send({ email: 'ravi@kisan.test', password: TEST_PASSWORD });
    expect(login.status).toBe(200);
    const list = await call('get', '/organizations?type=retailer', token);
    expect(list.body.data.map((o: { legalName: string }) => o.legalName)).toContain('Kisan Seeds Store');
  });
});
