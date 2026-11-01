import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ROLES, ROLE_PERMISSIONS, PERMISSIONS, type Role } from '@smartseed/shared';
import { createHarness, resetData, seedTenant, seedUser, tokenFor, type Harness } from './helpers';

interface Route {
  method: 'get' | 'post' | 'patch';
  path: string;
  allowed: Role[];
  tenantScoped: boolean;
}

/** Hand-written expectations (deliberately not derived from ROLE_PERMISSIONS). */
const ROUTES: Route[] = [
  { method: 'get', path: '/v1/users', allowed: ['company_admin'], tenantScoped: true },
  { method: 'post', path: '/v1/users', allowed: ['company_admin'], tenantScoped: true },
  { method: 'get', path: '/v1/audit-logs', allowed: ['company_admin'], tenantScoped: true },
  { method: 'get', path: '/v1/platform/tenants', allowed: ['platform_admin'], tenantScoped: false },
  { method: 'patch', path: '/v1/platform/tenants/00000000-0000-4000-8000-000000000000', allowed: ['platform_admin'], tenantScoped: false },
  { method: 'get', path: '/v1/platform/audit-logs', allowed: ['platform_admin'], tenantScoped: false },
];

let h: Harness;
let tenantId: string;
const tokens = {} as Record<Role, string>;

beforeAll(async () => {
  h = await createHarness();
  await resetData(h);
  tenantId = await seedTenant(h);
  for (const role of ROLES) {
    const tenantScoped = role === 'company_admin' || role === 'manufacturer';
    const u = await seedUser(h, { role, tenantId: tenantScoped ? tenantId : null });
    tokens[role] = await tokenFor(h, u.id, tenantScoped ? tenantId : null, [role]);
  }
});
afterAll(async () => { await h.close(); });

describe('authorization matrix', () => {
  for (const route of ROUTES) {
    it(`${route.method.toUpperCase()} ${route.path} requires authentication`, async () => {
      const res = await request(h.app)[route.method](route.path).send({});
      expect(res.status).toBe(401);
    });

    for (const role of ROLES) {
      const isAllowed = route.allowed.includes(role);
      it(`${route.method.toUpperCase()} ${route.path} as ${role} -> ${isAllowed ? 'permitted' : '403'}`, async () => {
        const res = await request(h.app)[route.method](route.path).set('Authorization', `Bearer ${tokens[role]}`).send({});
        if (isAllowed) expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(403);
      });
    }
  }

  it('a platform admin cannot use tenant-scoped data routes', async () => {
    const res = await request(h.app).get('/v1/users').set('Authorization', `Bearer ${tokens.platform_admin}`);
    expect(res.status).toBe(403);
  });
});

describe('permission matrix consistency', () => {
  it('every permission is granted to at least one role', () => {
    const granted = new Set(Object.values(ROLE_PERMISSIONS).flat());
    expect([...PERMISSIONS].filter((p) => !granted.has(p))).toEqual([]);
  });

  it('database RBAC seed matches the shared matrix', async () => {
    const res = await h.admin.query<{ role: string; perm: string }>(
      `SELECT r.name AS role, p.code AS perm FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id`);
    const fromDb = res.rows.map((r) => `${r.role}:${r.perm}`).sort();
    const fromCode = Object.entries(ROLE_PERMISSIONS).flatMap(([role, perms]) => perms.map((p) => `${role}:${p}`)).sort();
    expect(fromDb).toEqual(fromCode);
    const allPerms = await h.admin.query<{ code: string }>('SELECT code FROM permissions');
    expect(allPerms.rows.map((r) => r.code).sort()).toEqual([...PERMISSIONS].sort());
  });
});
