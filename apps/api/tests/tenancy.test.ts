import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHarness, resetData, seedTenant, seedUser, tokenFor, TEST_PASSWORD, type Harness } from './helpers';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await resetData(h); });

async function tenantWithAdmin() {
  const tenantId = await seedTenant(h);
  const admin = await seedUser(h, { role: 'company_admin', tenantId });
  const token = await tokenFor(h, admin.id, tenantId, ['company_admin']);
  return { tenantId, admin, token };
}

describe('API tenant isolation', () => {
  it('lists only the caller tenant users', async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    await seedUser(h, { role: 'manufacturer', tenantId: b.tenantId, email: 'secret@b.test' });

    const res = await request(h.app).get('/v1/users').set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    const emails = res.body.data.map((u: { email: string }) => u.email);
    expect(emails).toEqual([a.admin.email]);
  });

  it('creates users only inside the caller tenant, derived from the token', async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    const res = await request(h.app).post('/v1/users').set('Authorization', `Bearer ${a.token}`)
      .send({ email: 'new@a.test', fullName: 'New User', password: TEST_PASSWORD, role: 'manufacturer', tenantId: b.tenantId });
    expect(res.status).toBe(201);
    const row = await h.admin.query('SELECT tenant_id FROM users WHERE email = $1', ['new@a.test']);
    expect(row.rows[0].tenant_id).toBe(a.tenantId);
  });

  it('refuses to assign roles outside the tenant-assignable set', async () => {
    const a = await tenantWithAdmin();
    const res = await request(h.app).post('/v1/users').set('Authorization', `Bearer ${a.token}`)
      .send({ email: 'esc@a.test', fullName: 'Esc Alate', password: TEST_PASSWORD, role: 'platform_admin' });
    expect(res.status).toBe(400);
  });

  it('shows each tenant only its own audit trail', async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    await request(h.app).post('/v1/users').set('Authorization', `Bearer ${b.token}`)
      .send({ email: 'x@b.test', fullName: 'Xavier B', password: TEST_PASSWORD, role: 'manufacturer' });
    const res = await request(h.app).get('/v1/audit-logs').set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('blocks every request for a suspended tenant', async () => {
    const a = await tenantWithAdmin();
    await h.admin.query("UPDATE tenants SET status = 'suspended' WHERE id = $1", [a.tenantId]);
    const res = await request(h.app).get('/v1/users').set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_NOT_ACTIVE');
  });
});

describe('database row-level security (fail closed)', () => {
  it('hides other tenants rows and rejects cross-tenant writes', async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();

    const visible = await h.db.withTenant(a.tenantId, async (tx) => (await tx.query('SELECT tenant_id FROM users')).rows);
    expect(visible.every((r: { tenant_id: string }) => r.tenant_id === a.tenantId)).toBe(true);
    expect(visible).toHaveLength(1);

    await expect(
      h.db.withTenant(a.tenantId, (tx) =>
        tx.query("INSERT INTO users (tenant_id, email, full_name, password_hash) VALUES ($1, 'evil@x.test', 'Evil', 'x')", [b.tenantId])),
    ).rejects.toThrow(/row-level security/);
  });

  it('returns nothing when no tenant context is set', async () => {
    await tenantWithAdmin();
    const rows = await h.db.withNoContext(async (tx) => (await tx.query('SELECT id FROM users')).rows);
    expect(rows).toHaveLength(0);
  });

  it('prevents a tenant context from changing a foreign users roles or tokens', async () => {
    const a = await tenantWithAdmin();
    const b = await tenantWithAdmin();
    const res = await h.db.withTenant(a.tenantId, (tx) =>
      tx.query("UPDATE users SET full_name = 'hijacked' WHERE id = $1", [b.admin.id]));
    expect(res.rowCount).toBe(0);
  });

  it('application role cannot bypass RLS', async () => {
    const res = await h.admin.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'smartseed_app'");
    expect(res.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});
