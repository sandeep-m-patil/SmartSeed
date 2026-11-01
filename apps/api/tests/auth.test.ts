import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { SignJWT, generateKeyPair } from 'jose';
import {
  createHarness, currentTotp, loginWithMfa, resetData, seedTenant, seedUser, tokenFor, TEST_PASSWORD, type Harness,
} from './helpers';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await resetData(h); });

const register = (email = 'owner@acme.test') =>
  request(h.app).post('/v1/tenants/register').send({
    companyName: 'Acme Seeds', adminName: 'Ada Owner', adminEmail: email, adminPassword: TEST_PASSWORD,
  });

async function approve(tenantId: string): Promise<void> {
  const admin = await seedUser(h, { role: 'platform_admin', tenantId: null });
  const token = await tokenFor(h, admin.id, null, ['platform_admin']);
  const res = await request(h.app).patch(`/v1/platform/tenants/${tenantId}`).set('Authorization', `Bearer ${token}`).send({ status: 'active' });
  expect(res.status).toBe(200);
}

describe('tenant registration and approval', () => {
  it('creates a pending tenant whose admin cannot log in until approved', async () => {
    const reg = await register();
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ data: { status: 'pending' }, error: null });

    const denied = await request(h.app).post('/v1/auth/login').send({ email: 'owner@acme.test', password: TEST_PASSWORD });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('TENANT_NOT_ACTIVE');
  });

  it('rejects weak passwords and duplicate emails', async () => {
    const weak = await request(h.app).post('/v1/tenants/register').send({
      companyName: 'Weak Co', adminName: 'Wes Weak', adminEmail: 'w@x.test', adminPassword: 'short',
    });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');

    await register('dup@acme.test');
    expect((await register('dup@acme.test')).status).toBe(409);
  });

  it('rejects an invalid tenant status transition', async () => {
    const tenantId = await seedTenant(h, 'pending');
    const admin = await seedUser(h, { role: 'platform_admin', tenantId: null });
    const token = await tokenFor(h, admin.id, null, ['platform_admin']);
    const res = await request(h.app).patch(`/v1/platform/tenants/${tenantId}`).set('Authorization', `Bearer ${token}`).send({ status: 'suspended' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('MFA for privileged roles', () => {
  it('forces enrollment, issues a session only after a valid code, and blocks code replay', async () => {
    const reg = await register();
    await approve(reg.body.data.tenantId);

    const login = await request(h.app).post('/v1/auth/login').send({ email: 'owner@acme.test', password: TEST_PASSWORD });
    expect(login.body.data).toMatchObject({ mfaRequired: true, mfaEnrollmentRequired: true });
    expect(login.body.data.accessToken).toBeUndefined();

    const { mfaToken } = login.body.data;
    const enroll = await request(h.app).post('/v1/auth/mfa/enroll').send({ mfaToken });
    const code = authenticator.generate(enroll.body.data.secret);

    const bad = await request(h.app).post('/v1/auth/mfa/verify').send({ mfaToken, code: code === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(401);

    const good = await request(h.app).post('/v1/auth/mfa/verify').send({ mfaToken, code });
    expect(good.status).toBe(200);
    const me = await request(h.app).get('/v1/auth/me').set('Authorization', `Bearer ${good.body.data.accessToken}`);
    expect(me.body.data.email).toBe('owner@acme.test');

    const replay = await request(h.app).post('/v1/auth/mfa/verify').send({ mfaToken, code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_MFA_CODE');
  });

  it('does not accept an access token where an MFA token is required', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const access = await tokenFor(h, u.id, tenantId, ['manufacturer']);
    const res = await request(h.app).post('/v1/auth/mfa/enroll').send({ mfaToken: access });
    expect(res.status).toBe(401);
  });

  it('refuses a privileged access token that lacks the MFA claim', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'company_admin', tenantId });
    const token = await h.tokens.signAccess({ sub: u.id, tid: tenantId, oid: null, roles: ['company_admin'], mfa: false });
    const res = await request(h.app).get('/v1/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });

  it('requires a fresh code for subsequent logins (enrolled user)', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'company_admin', tenantId });
    await loginWithMfa(h, u.email);
    const login = await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(login.body.data.mfaEnrollmentRequired).toBe(false);
    expect(await currentTotp(h, u.id)).toMatch(/^\d{6}$/);
  });
});

describe('credentials and lockout', () => {
  it('returns the same error for unknown users and wrong passwords', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const a = await request(h.app).post('/v1/auth/login').send({ email: u.email, password: 'Wrong-password-1A' });
    const b = await request(h.app).post('/v1/auth/login').send({ email: 'nobody@x.test', password: 'Wrong-password-1A' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error).toEqual(b.body.error);
  });

  it('locks the account after repeated failures, even for the right password', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    for (let i = 0; i < 5; i++) {
      await request(h.app).post('/v1/auth/login').send({ email: u.email, password: 'Wrong-password-1A' });
    }
    const res = await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(401);
  });

  it('logs a non-privileged user straight in', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const res = await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeTruthy();
  });
});

describe('refresh token rotation', () => {
  it('rotates on use and revokes the whole family when an old token is replayed', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const first = (await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD })).body.data;

    const second = await request(h.app).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(second.status).toBe(200);
    expect(second.body.data.refreshToken).not.toBe(first.refreshToken);

    const replay = await request(h.app).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);

    const afterReplay = await request(h.app).post('/v1/auth/refresh').send({ refreshToken: second.body.data.refreshToken });
    expect(afterReplay.status).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const s = (await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD })).body.data;
    await request(h.app).post('/v1/auth/logout').send({ refreshToken: s.refreshToken });
    expect((await request(h.app).post('/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });

  it('refuses refresh once the tenant is suspended', async () => {
    const tenantId = await seedTenant(h);
    const u = await seedUser(h, { role: 'manufacturer', tenantId });
    const s = (await request(h.app).post('/v1/auth/login').send({ email: u.email, password: TEST_PASSWORD })).body.data;
    await h.admin.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [tenantId]);
    expect((await request(h.app).post('/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
  });
});

describe('token hardening', () => {
  it('rejects tokens signed by a different key', async () => {
    const { privateKey } = await generateKeyPair('ES256');
    const forged = await new SignJWT({ scope: 'access', tid: null, roles: ['platform_admin'], mfa: true })
      .setProtectedHeader({ alg: 'ES256' }).setSubject('x').setIssuer('smartseed').setExpirationTime('5m').sign(privateKey);
    const res = await request(h.app).get('/v1/platform/tenants').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects missing credentials with the standard envelope', async () => {
    const res = await request(h.app).get('/v1/users');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ data: null, error: { code: 'UNAUTHORIZED' } });
    expect(res.body.meta.requestId).toBeTruthy();
  });
});

describe('rate limiting', () => {
  it('returns 429 with Retry-After once the auth limit is exceeded', async () => {
    const limited = await createHarness({ RATE_LIMIT_AUTH_MAX: '3' });
    try {
      const statuses: number[] = [];
      let last = await request(limited.app).post('/v1/auth/login').send({ email: 'a@b.test', password: 'x' });
      statuses.push(last.status);
      for (let i = 0; i < 3; i++) {
        last = await request(limited.app).post('/v1/auth/login').send({ email: 'a@b.test', password: 'x' });
        statuses.push(last.status);
      }
      expect(statuses.at(-1)).toBe(429);
      expect(last.headers['retry-after']).toBeTruthy();
      expect(last.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
