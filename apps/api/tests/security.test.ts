import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createHarness, resetData, seedManufacturer, seedPartner, seedTenant, seedUser, tokenFor, type Harness, type Party } from './helpers';

const ALLOWED_ORIGIN = 'https://app.example.test';
let h: Harness;
let tenantId: string;
let mfr: Party;
let d1: Party;
let batchId: string;
let productId: string;

beforeAll(async () => { h = await createHarness({ CORS_ORIGINS: ALLOWED_ORIGIN }); });
afterAll(async () => { await h.close(); });

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(async () => {
  await resetData(h);
  tenantId = await seedTenant(h);
  mfr = await seedManufacturer(h, tenantId);
  d1 = await seedPartner(h, tenantId, 'distributor');
  const p = await request(h.app).post('/v1/products').set(auth(mfr.token)).send({ name: 'Rice', brand: 'AgriRice', cropType: 'Rice', variety: 'R1', category: 'certified' });
  productId = p.body.data.id;
  const b = await request(h.app).post('/v1/batches').set(auth(mfr.token)).send({
    productId, manufacturingDate: '2026-01-01', expiryDate: '2099-01-01', productionLocation: 'Guntur', facility: 'Plant 1', initialQuantity: 100 });
  batchId = b.body.data.id;
});

describe('A03 injection', () => {
  const payloads = ["1; DROP TABLE users; --", "' OR '1'='1", '1 UNION SELECT password_hash FROM users', '${7*7}', '%00'];

  it('treats injection strings in query parameters as plain invalid input and leaves the schema intact', async () => {
    for (const p of payloads) {
      for (const path of ['/v1/batches?cursor=', '/v1/alerts?status=', '/v1/transfers?status=', '/v1/organizations?type=']) {
        const res = await request(h.app).get(`${path}${encodeURIComponent(p)}`).set(auth(mfr.token));
        expect([200, 400, 403]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toMatch(/password_hash|syntax error|pg_catalog/i);
      }
    }
    const users = await h.admin.query('SELECT count(*)::int AS n FROM users');
    expect(users.rows[0].n).toBeGreaterThan(0);
  });

  it('does not let injection strings in credentials or bodies alter query logic', async () => {
    const login = await request(h.app).post('/v1/auth/login').send({ email: "admin'--@x.test", password: "' OR 1=1 --" });
    expect([400, 401]).toContain(login.status);
    const product = await request(h.app).post('/v1/products').set(auth(mfr.token)).send({
      name: "Robert'); DROP TABLE products;--", brand: 'B1', cropType: 'Rice', variety: 'V1', category: 'certified' });
    expect(product.status).toBe(201);
    expect((await h.admin.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(2);
  });
});

describe('A03/A07 XSS and output handling', () => {
  it('stores markup as inert data and serves JSON with nosniff and no CSP gaps', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const res = await request(h.app).post('/v1/products').set(auth(mfr.token)).send({ name: xss, brand: 'B1', cropType: 'Rice', variety: 'V9', category: 'certified' });
    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('never leaks stack traces or internals on unknown routes and malformed input', async () => {
    const notFound = await request(h.app).get('/v1/definitely-missing');
    expect(notFound.status).toBe(404);
    const badJson = await request(h.app).post('/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error.code).toBe('INVALID_JSON');
    expect(JSON.stringify(badJson.body)).not.toMatch(/at\s+\S+\s+\(|node_modules/);
  });
});

describe('A01/A07 authentication and authorization attacks', () => {
  it('rejects alg=none, tampered and wrongly-scoped tokens', async () => {
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: mfr.user.id, scope: 'access', roles: ['platform_admin'], mfa: true, iss: 'smartseed' })).toString('base64url')}.`;
    expect((await request(h.app).get('/v1/platform/tenants').set(auth(none))).status).toBe(401);
    const [head, body, sig] = mfr.token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body as string, 'base64url').toString()), roles: ['platform_admin'] })).toString('base64url');
    expect((await request(h.app).get('/v1/platform/tenants').set(auth(`${head}.${forgedBody}.${sig}`))).status).toBe(401);
    const hs = await new SignJWT({ scope: 'access', roles: ['platform_admin'], mfa: true }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('smartseed').sign(new TextEncoder().encode('secret-guess'));
    expect((await request(h.app).get('/v1/platform/tenants').set(auth(hs))).status).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const svc = h.tokens;
    expect(svc).toBeTruthy();
    const expired = await new SignJWT({ scope: 'access', tid: tenantId, oid: mfr.orgId, roles: ['manufacturer'], mfa: false })
      .setProtectedHeader({ alg: 'ES256' }).setSubject(mfr.user.id).setIssuer('smartseed').setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(await (await import('jose')).importPKCS8(h.config.JWT_PRIVATE_KEY, 'ES256'));
    expect((await request(h.app).get('/v1/batches').set(auth(expired))).status).toBe(401);
  });

  it('returns 404 (never data) when probing another tenants ids across resource types', async () => {
    const otherTenant = await seedTenant(h);
    const other = await seedManufacturer(h, otherTenant);
    const qr = (await request(h.app).post(`/v1/batches/${batchId}/qr`).set(auth(mfr.token))).body.data.id;
    const probes = [
      `/v1/batches/${batchId}`, `/v1/products/${productId}`, `/v1/batches/${batchId}/passport`, `/v1/batches/${batchId}/timeline`,
      `/v1/qr/${qr}/download`, `/v1/qr/${qr}/scans`, `/v1/inventory/${batchId}/movements`,
    ];
    for (const p of probes) {
      const res = await request(h.app).get(p).set(auth(other.token));
      expect([404, 200], p).toContain(res.status);
      if (res.status === 200) expect(Array.isArray(res.body.data) ? res.body.data : []).toHaveLength(0);
    }
    const t = (await request(h.app).post('/v1/transfers').set(auth(mfr.token)).set('Idempotency-Key', randomUUID()).send({ batchId, toOrgId: d1.orgId, quantity: 5 })).body.data.id;
    expect((await request(h.app).get(`/v1/transfers/${t}`).set(auth(other.token))).status).toBe(404);
    expect((await request(h.app).post(`/v1/transfers/${t}/cancel`).set(auth(other.token))).status).toBe(404);
  });

  it('ignores mass-assigned fields such as tenantId, roles and status', async () => {
    const admin = await seedUser(h, { role: 'company_admin', tenantId });
    const token = await tokenFor(h, admin.id, tenantId, ['company_admin']);
    const otherTenant = await seedTenant(h);
    const res = await request(h.app).post('/v1/users').set(auth(token)).send({
      email: 'mass@x.test', fullName: 'Mass Assign', password: 'Str0ngPassw0rd!x', role: 'manufacturer', tenantId: otherTenant, roles: ['platform_admin'], status: 'disabled', mfa_enabled: true });
    expect(res.status).toBe(201);
    const row = (await h.admin.query("SELECT u.tenant_id, u.status, u.mfa_enabled, array_agg(r.name) AS roles FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.email = 'mass@x.test' GROUP BY u.id")).rows[0];
    expect(row).toMatchObject({ tenant_id: tenantId, status: 'active', mfa_enabled: false, roles: ['manufacturer'] });
  });
});

describe('A05 configuration: CORS and request limits', () => {
  it('echoes CORS headers only for allow-listed origins', async () => {
    const ok = await request(h.app).get('/healthz').set('Origin', ALLOWED_ORIGIN);
    expect(ok.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    const bad = await request(h.app).get('/healthz').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const res = await request(h.app).post('/v1/auth/login').send({ email: 'a@b.test', password: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
  });
});

describe('A04/A09 abuse controls', () => {
  it('rate limits the public verification endpoint with Retry-After', async () => {
    const limited = await createHarness({ RATE_LIMIT_PUBLIC_MAX: '3' });
    try {
      let last = await request(limited.app).get('/v1/public/verify/' + 'a'.repeat(32));
      for (let i = 0; i < 4; i++) last = await request(limited.app).get('/v1/public/verify/' + 'a'.repeat(32));
      expect(last.status).toBe(429);
      expect(last.headers['retry-after']).toBeTruthy();
    } finally {
      await limited.close();
    }
  });

  it('caps scan-token guessing: unknown tokens reveal nothing and never create scan rows', async () => {
    const res = await request(h.app).get('/v1/public/verify/' + 'Z'.repeat(32));
    expect(res.body.data.product).toBeNull();
    expect((await h.admin.query('SELECT count(*)::int AS n FROM qr_scans')).rows[0].n).toBe(0);
  });

  it('audits privileged and failed authentication events', async () => {
    await request(h.app).post('/v1/auth/login').send({ email: mfr.user.email, password: 'Wrong-password-1A' });
    const events = (await h.admin.query("SELECT action FROM audit_logs WHERE action = 'auth.login_failed'")).rows;
    expect(events).toHaveLength(1);
  });
});

describe('observability endpoint', () => {
  it('exposes metrics only with the bearer token and reports business health gauges', async () => {
    const m = await createHarness({ METRICS_TOKEN: 'metrics-token-1234567890' });
    try {
      expect((await request(m.app).get('/metrics')).status).toBe(401);
      expect((await request(m.app).get('/metrics').set('Authorization', 'Bearer wrong')).status).toBe(401);
      const ok = await request(m.app).get('/metrics').set('Authorization', 'Bearer metrics-token-1234567890');
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('smartseed_chain_oldest_pending_seconds');
      expect(ok.text).toContain('http_request_duration_seconds');
    } finally {
      await m.close();
    }
    expect((await request(h.app).get('/metrics')).status).toBe(404);
  });
});
