import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { processOutbox } from '../src/blockchain/outbox';
import { buildHandlers } from '../src/jobs/handlers';
import { runDueJobs } from '../src/jobs/queue';
import { createInvestigationService } from '../src/investigations/service';
import { createNotificationService } from '../src/notifications/service';
import { raiseAlert } from '../src/risk/alerts';
import { subscriptionSweep } from '../src/billing/razorpay';
import { decryptField } from '../src/lib/crypto';
import { FakeEmail, FakePush, RecordingGateway, silentLogger, testSigner } from './doubles';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, seedUser, tokenFor, type Harness, type Party } from './helpers';

const WEBHOOK_SECRET = 'whsec_test_secret';
let h: Harness;
let sse: Harness;
let tenantId: string;
let mfr: Party;
let d1: Party;
let admin: { id: string; token: string };
let batchId: string;
let email: FakeEmail;
let push: FakePush;
let gw: RecordingGateway;

beforeAll(async () => {
  h = await createHarness({ RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET });
  sse = await createHarness({ SSE_INTERVAL_MS: '150' });
});
afterAll(async () => { await h.close(); await sse.close(); });

const call = (method: 'get' | 'post' | 'put' | 'patch', path: string, token: string, body?: unknown, key?: string) => {
  const req = request(h.app)[method](`/v1${path}`).set('Authorization', `Bearer ${token}`);
  if (key) req.set('Idempotency-Key', key);
  return body === undefined ? req : req.send(body as object);
};

function workerDeps() {
  const notifications = createNotificationService({ db: h.db, email, push, logger: silentLogger, encryptionKey: h.config.FIELD_ENCRYPTION_KEY });
  return buildHandlers({
    db: h.db, logger: silentLogger, notifications, billingGraceDays: 7, ledger: gw,
    investigations: createInvestigationService({ db: h.db, logger: silentLogger }),
  });
}

async function runJobs() {
  await h.admin.query("UPDATE jobs SET run_at = now() WHERE status = 'queued'");
  for (let i = 0; i < 4; i++) if ((await runDueJobs(h.db, workerDeps())) === 0) break;
}

const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function newBatch(expiry = '2099-01-01', quantity = 200) {
  const p = await call('post', '/products', mfr.token, { name: `Maize ${randomUUID().slice(0, 4)}`, brand: 'AgriBest', cropType: 'Maize', variety: 'M1', category: 'hybrid' });
  const b = await call('post', '/batches', mfr.token, {
    productId: p.body.data.id, manufacturingDate: '2026-01-01', expiryDate: expiry, productionLocation: 'Pune', facility: 'F1', initialQuantity: quantity,
  });
  expect(b.status).toBe(201);
  return b.body.data.id as string;
}

beforeEach(async () => {
  await resetData(h);
  await h.admin.query("UPDATE plans SET limits = '{\"batches\": 50, \"users\": 5, \"scans\": 5000}' WHERE code = 'trial'");
  email = new FakeEmail();
  push = new FakePush();
  gw = new RecordingGateway();
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  const a = await seedUser(h, { role: 'company_admin', tenantId });
  admin = { id: a.id, token: await tokenFor(h, a.id, tenantId, ['company_admin']) };
  batchId = await newBatch();
});

describe('notifications', () => {
  it('notifies the receiver after the transfer is committed on-chain, once, in-app and by email', async () => {
    await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 50 }, randomUUID());
    expect((await h.admin.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n).toBe(0);
    const { signer } = testSigner();
    for (let i = 0; i < 4; i++) await processOutbox({ db: h.db, gateway: gw, signer, logger: silentLogger, usePrivateData: false });
    await runJobs();
    const mine = (await call('get', '/notifications', d1.token)).body.data;
    expect(mine.map((n: { type: string }) => n.type)).toEqual(['transfer.incoming']);
    expect(email.sent.filter((m) => m.to === d1.user.email).map((m) => m.subject)).toEqual([expect.stringContaining('Incoming batch')]);
    await runJobs();
    expect((await call('get', '/notifications', d1.token)).body.data).toHaveLength(1);
    const staff = (await call('get', '/notifications', mfr.token)).body.data.map((n: { type: string }) => n.type);
    expect(staff).toContain('batch.registered');
  });

  it('respects preferences, supports marking as read and exposes only own notifications', async () => {
    await call('put', '/notification-preferences', d1.token, [{ type: 'transfer.incoming', channel: 'email', enabled: false }]);
    await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 10 }, randomUUID());
    const { signer } = testSigner();
    for (let i = 0; i < 4; i++) await processOutbox({ db: h.db, gateway: gw, signer, logger: silentLogger, usePrivateData: false });
    await runJobs();
    expect(email.sent.filter((m) => m.to === d1.user.email)).toHaveLength(0);
    const list = (await call('get', '/notifications', d1.token)).body.data;
    expect(list).toHaveLength(1);
    expect((await call('post', `/notifications/${list[0].id}/read`, d1.token)).status).toBe(200);
    expect((await call('get', '/notifications', d1.token)).body.data[0].readAt).toBeTruthy();
    expect((await call('post', `/notifications/${list[0].id}/read`, mfr.token)).status).toBe(404);
    expect((await call('get', '/notification-preferences', d1.token)).body.data).toEqual([{ type: 'transfer.incoming', channel: 'email', enabled: false }]);
  });

  it('alerts staff, and pushes a warning to farmer devices that recently scanned a critical batch', async () => {
    const qr = (await call('post', `/batches/${batchId}/qr`, mfr.token)).body.data.id;
    const token = decryptField((await h.admin.query('SELECT token_enc FROM qr_codes WHERE id = $1', [qr])).rows[0].token_enc, h.config.FIELD_ENCRYPTION_KEY);
    const deviceId = randomUUID();
    await request(h.app).post('/v1/public/devices').send({ deviceId, language: 'hi', pushToken: 'ExponentPushToken[abc]' });
    await request(h.app).get(`/v1/public/verify/${token}`).set('X-Device-Id', deviceId);
    await h.db.withSystem((tx) => raiseAlert(tx, { tenantId, batchId, alertType: 'SCAN_ANOMALY', severity: 'CRITICAL', riskScore: 88, summary: 'Burst of scans' }));
    const alertId = (await h.admin.query('SELECT id FROM alerts')).rows[0].id;
    await h.admin.query("INSERT INTO jobs (type, payload) VALUES ('notify_alert', $1)", [JSON.stringify({ alertId })]);
    await runJobs();
    const staff = (await call('get', '/notifications', admin.token)).body.data;
    expect(staff[0]).toMatchObject({ type: 'alert.critical' });
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]?.token).toBe('ExponentPushToken[abc]');
    const farmer = await request(h.app).get(`/v1/public/notifications?deviceId=${deviceId}`);
    expect(farmer.body.data[0]).toMatchObject({ type: 'batch.warning' });
  });

  it('warns holders of stock close to expiry exactly once per window', async () => {
    await newBatch(addDays(5), 40);
    await h.admin.query("INSERT INTO jobs (type) VALUES ('expiry_sweep')");
    await runJobs();
    await h.admin.query("INSERT INTO jobs (type) VALUES ('expiry_sweep')");
    await runJobs();
    const warnings = (await h.admin.query("SELECT count(*)::int AS n FROM notifications WHERE type = 'expiry.warning' AND channel = 'in_app'")).rows[0].n;
    expect(warnings).toBe(2 * 2); // two users in the manufacturer org? no: one org user x two windows, per run deduped
  });

  it('retries a failing delivery and records the error without losing the notification', async () => {
    email.send = async () => { throw new Error('smtp down'); };
    await call('post', '/transfers', mfr.token, { batchId, toOrgId: d1.orgId, quantity: 5 }, randomUUID());
    const { signer } = testSigner();
    for (let i = 0; i < 4; i++) await processOutbox({ db: h.db, gateway: gw, signer, logger: silentLogger, usePrivateData: false });
    await runJobs();
    const failed = await h.admin.query("SELECT status, last_error FROM jobs WHERE type = 'deliver_notification' AND status <> 'done'");
    expect(failed.rows[0]).toMatchObject({ status: 'queued' });
    expect(failed.rows[0].last_error).toContain('smtp down');
    expect((await h.admin.query("SELECT sent_at FROM notifications WHERE channel = 'email'")).rows[0].sent_at).toBeNull();
  });
});

describe('subscription and usage', () => {
  async function subscribe(limits: object) {
    await h.admin.query("UPDATE plans SET limits = $1 WHERE code = 'trial'", [JSON.stringify(limits)]);
    await h.admin.query("INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at) SELECT $1, id, 'trialing', now() + interval '14 days' FROM plans WHERE code = 'trial'", [tenantId]);
  }

  it('reports subscription and metered usage and blocks creation beyond plan limits', async () => {
    await subscribe({ batches: 2, users: 5, scans: 100 });
    const sub = (await call('get', '/subscription', admin.token)).body.data;
    expect(sub).toMatchObject({ plan: { code: 'trial' }, status: 'trialing' });
    expect((await call('get', '/usage', admin.token)).body.data.batches).toEqual({ used: 1, limit: 2 });
    await newBatch();
    const p = await call('get', '/products', mfr.token);
    const blocked = await call('post', '/batches', mfr.token, {
      productId: p.body.data[0].id, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Pune', facility: 'F1', initialQuantity: 5,
    });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED', details: { metric: 'batches', limit: 2 } });
    expect((await call('get', '/subscription', mfr.token)).status).toBe(403);
  });

  it('lets a platform admin define plans and change a tenant plan; pricing is data', async () => {
    await subscribe({ batches: 1 });
    const platform = await seedUser(h, { role: 'platform_admin', tenantId: null });
    const token = await tokenFor(h, platform.id, null, ['platform_admin']);
    const plan = { code: 'growth', name: 'Growth', limits: { batches: 500, users: 25 }, priceMinor: 499900, currency: 'INR' };
    expect((await call('post', '/platform/plans', token, plan)).status).toBe(201);
    expect((await call('get', '/platform/plans', token)).body.data.map((p: { code: string }) => p.code)).toContain('growth');
    expect((await call('put', `/platform/tenants/${tenantId}/subscription`, token, { planCode: 'growth' })).status).toBe(200);
    expect((await call('get', '/subscription', admin.token)).body.data.plan).toMatchObject({ code: 'growth', priceMinor: 499900 });
    expect((await call('post', '/platform/plans', admin.token, plan)).status).toBe(403);
    expect((await call('post', `/platform/tenants/${tenantId}/billing/checkout`, token, { planCode: 'growth' })).body.error.code).toBe('BILLING_NOT_CONFIGURED');
  });

  const hook = (event: object, signature?: string) => {
    const body = JSON.stringify(event);
    const sig = signature ?? createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
    return request(h.app).post('/v1/billing/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', sig).send(body);
  };

  it('accepts only correctly signed gateway webhooks and applies them idempotently', async () => {
    await subscribe({ batches: 10 });
    await h.admin.query("UPDATE subscriptions SET gateway_ref = 'sub_123' WHERE tenant_id = $1", [tenantId]);
    const event = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_123', current_end: 1_900_000_000 } }, payment: { entity: { id: 'pay_1', amount: 499900, currency: 'INR', subscription_id: 'sub_123' } } } };
    expect((await hook(event, 'deadbeef')).status).toBe(403);
    expect((await hook(event)).status).toBe(200);
    expect((await hook(event)).status).toBe(200);
    expect((await h.admin.query('SELECT status FROM subscriptions')).rows[0].status).toBe('active');
    const invoices = (await call('get', '/invoices', admin.token)).body.data;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'paid', amountMinor: 499900, currency: 'INR' });
    await hook({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_2', amount: 499900, currency: 'INR', subscription_id: 'sub_123' } } } });
    expect((await h.admin.query('SELECT status FROM subscriptions')).rows[0].status).toBe('past_due');
  });

  it('moves expired trials to past_due and suspends tenants after the grace period', async () => {
    await subscribe({ batches: 10 });
    await h.admin.query("UPDATE subscriptions SET trial_ends_at = now() - interval '2 days'");
    expect(await subscriptionSweep(h.db, 7)).toEqual({ pastDue: 1, suspended: 0 });
    await h.admin.query("UPDATE subscriptions SET renews_at = now() - interval '10 days'");
    expect(await subscriptionSweep(h.db, 7)).toEqual({ pastDue: 0, suspended: 1 });
    expect((await h.admin.query('SELECT status FROM tenants WHERE id = $1', [tenantId])).rows[0].status).toBe('suspended');
    expect((await call('get', '/subscription', admin.token)).status).toBe(403);
  });
});

describe('server-sent events', () => {
  it('streams new alerts for the caller tenant only', async () => {
    const server = sse.app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const a = await seedUser(sse, { role: 'company_admin', tenantId });
    const token = await tokenFor(sse, a.id, tenantId, ['company_admin']);
    const otherTenant = await seedTenant(h);
    const received: string[] = [];
    const req = http.get({ port, path: '/v1/events', headers: { Authorization: `Bearer ${token}` } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => received.push(chunk));
    });
    try {
      await new Promise((r) => setTimeout(r, 400));
      await h.db.withSystem((tx) => raiseAlert(tx, { tenantId, batchId, alertType: 'SCAN_ANOMALY', severity: 'HIGH', riskScore: 60, summary: 'x' }));
      const otherMfr = await seedManufacturer(h, otherTenant);
      const otherBatch = await request(h.app).post('/v1/products').set('Authorization', `Bearer ${otherMfr.token}`).send({ name: 'Other', brand: 'Other', cropType: 'Rice', variety: 'R', category: 'certified' });
      const ob = await request(h.app).post('/v1/batches').set('Authorization', `Bearer ${otherMfr.token}`).send({
        productId: otherBatch.body.data.id, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Plot 1', facility: 'Plant 1', initialQuantity: 5 });
      await h.db.withSystem((tx) => raiseAlert(tx, { tenantId: otherTenant, batchId: ob.body.data.id, alertType: 'SCAN_ANOMALY', severity: 'HIGH', riskScore: 60, summary: 'secret' }));
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !received.join('').includes('alert.created')) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      req.destroy();
      server.close();
    }
    const text = received.join('');
    expect(text).toContain('alert.created');
    expect(text).toContain(batchId);
    expect(text).not.toContain('secret');
  });

  it('requires authentication', async () => {
    expect((await request(h.app).get('/v1/events')).status).toBe(401);
  });
});
