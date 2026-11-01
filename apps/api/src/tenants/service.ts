import { randomBytes, randomUUID } from 'node:crypto';
import type { RegisterTenantInput, TenantStatus } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import { conflict, notFound, badRequest } from '../errors';
import { writeAudit } from '../audit/audit';
import { hashPassword } from '../auth/password';
import { decodeCursor, toPage } from '../lib/pagination';

const TRIAL_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const SLUG_SUFFIX_BYTES = 3;
const UNIQUE_VIOLATION = '23505';

const ALLOWED_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  pending: ['active'],
  active: ['suspended'],
  suspended: ['active'],
};

const slugify = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${randomBytes(SLUG_SUFFIX_BYTES).toString('hex')}`;

export interface TenantRow {
  id: string; name: string; slug: string; status: TenantStatus; created_at: Date;
}

/** Every tenant owns exactly one manufacturer organization, linked as relationship 'self'. */
async function insertSelfOrg(tx: Tx, tenantId: string, legalName: string): Promise<string> {
  const orgId = randomUUID();
  await tx.query('INSERT INTO organizations (id, type, legal_name, registration_no) VALUES ($1,$2,$3,$4)', [
    orgId, 'manufacturer', legalName, `TENANT-${tenantId}`,
  ]);
  await tx.query("INSERT INTO tenant_organizations (tenant_id, org_id, relationship) VALUES ($1,$2,'self')", [tenantId, orgId]);
  return orgId;
}

async function insertTenantAdmin(tx: Tx, tenantId: string, input: RegisterTenantInput): Promise<string> {
  const passwordHash = await hashPassword(input.adminPassword);
  const orgId = await insertSelfOrg(tx, tenantId, input.companyName);
  const user = await tx.query<{ id: string }>(
    'INSERT INTO users (tenant_id, org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [tenantId, orgId, input.adminEmail, input.adminName, passwordHash],
  );
  const userId = user.rows[0]?.id as string;
  await tx.query("INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'company_admin'", [userId]);
  return userId;
}

export function createTenantService(db: Db) {
  async function register(input: RegisterTenantInput, ip: string): Promise<{ tenantId: string; status: TenantStatus }> {
    try {
      return await db.withSystem(async (tx) => {
        const t = await tx.query<{ id: string }>(
          'INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id', [input.companyName, slugify(input.companyName)]);
        const tenantId = t.rows[0]?.id as string;
        const adminId = await insertTenantAdmin(tx, tenantId, input);
        await tx.query(
          `INSERT INTO subscriptions (tenant_id, plan_id, status, trial_ends_at)
           SELECT $1, id, 'trialing', $2 FROM plans WHERE code = 'trial'`,
          [tenantId, new Date(Date.now() + TRIAL_DAYS * MS_PER_DAY)],
        );
        await writeAudit(tx, { tenantId, actorId: adminId, action: 'tenant.registered', entityType: 'tenant', entityId: tenantId, ip });
        return { tenantId, status: 'pending' as const };
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      throw err;
    }
  }

  async function list(q: { limit: number; cursor?: string | undefined; status?: TenantStatus | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withSystem(async (tx) =>
      (await tx.query<TenantRow>(
        `SELECT id, name, slug, status, created_at FROM tenants
         WHERE ($1::tenant_status IS NULL OR status = $1)
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [q.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    return toPage(rows, q.limit);
  }

  async function setStatus(tenantId: string, status: 'active' | 'suspended', actorId: string, ip: string): Promise<TenantRow> {
    return db.withSystem(async (tx) => {
      const cur = await tx.query<TenantRow>('SELECT id, name, slug, status, created_at FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
      const tenant = cur.rows[0];
      if (!tenant) throw notFound('Tenant not found');
      if (!ALLOWED_TRANSITIONS[tenant.status].includes(status)) {
        throw badRequest('INVALID_TRANSITION', `Cannot change tenant from ${tenant.status} to ${status}`);
      }
      await tx.query('UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1', [tenantId, status]);
      await writeAudit(tx, {
        tenantId, actorId, action: `tenant.${status === 'active' ? 'activated' : 'suspended'}`,
        entityType: 'tenant', entityId: tenantId, ip, metadata: { from: tenant.status, to: status },
      });
      return { ...tenant, status };
    });
  }

  return { register, list, setStatus };
}

export type TenantService = ReturnType<typeof createTenantService>;
