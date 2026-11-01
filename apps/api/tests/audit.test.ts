import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { verifyAuditChain, canonicalJson } from '../src/audit/audit';
import { createHarness, resetData, seedTenant, seedUser, tokenFor, TEST_PASSWORD, type Harness } from './helpers';

let h: Harness;
let tenantId: string;
let token: string;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => {
  await resetData(h);
  tenantId = await seedTenant(h);
  const admin = await seedUser(h, { role: 'company_admin', tenantId });
  token = await tokenFor(h, admin.id, tenantId, ['company_admin']);
  for (const n of [1, 2, 3]) {
    await request(h.app).post('/v1/users').set('Authorization', `Bearer ${token}`)
      .send({ email: `u${n}@t.test`, fullName: `User ${n}`, password: TEST_PASSWORD, role: 'manufacturer' });
  }
});

describe('audit log', () => {
  it('records state changes in a verifiable hash chain', async () => {
    const result = await h.db.withSystem((tx) => verifyAuditChain(tx, tenantId));
    expect(result).toMatchObject({ valid: true, checked: 3 });
  });

  it('is append-only even for the table owner', async () => {
    await expect(h.admin.query('UPDATE audit_logs SET action = $1', ['tampered'])).rejects.toThrow(/append-only/);
    await expect(h.admin.query('DELETE FROM audit_logs')).rejects.toThrow(/append-only/);
  });

  it('detects tampering made with the guard disabled', async () => {
    await h.admin.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only');
    try {
      await h.admin.query("UPDATE audit_logs SET action = 'user.deleted' WHERE seq = (SELECT min(seq) FROM audit_logs)");
    } finally {
      await h.admin.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only');
    }
    const result = await h.db.withSystem((tx) => verifyAuditChain(tx, tenantId));
    expect(result.valid).toBe(false);
  });

  it('pages through entries with a cursor', async () => {
    const first = await request(h.app).get('/v1/audit-logs?limit=2').set('Authorization', `Bearer ${token}`);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.nextCursor).toBeTruthy();
    const second = await request(h.app).get(`/v1/audit-logs?limit=2&cursor=${first.body.meta.nextCursor}`).set('Authorization', `Bearer ${token}`);
    expect(second.body.data).toHaveLength(1);
  });

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
