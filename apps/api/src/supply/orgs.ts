import { randomUUID } from 'node:crypto';
import type { CreateOrganizationInput } from '@smartseed/shared';
import type { Db } from '../db/db';
import { conflict, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { hashPassword } from '../auth/password';
import type { Actor, TenantActor } from './actor';

const UNIQUE_VIOLATION = '23505';

interface OrgRow {
  id: string;
  type: string;
  legal_name: string;
  registration_no: string;
  status: string;
  relationship?: string;
}

export function createOrgService(db: Db) {
  /** Creates a NEW partner organization plus its first user and links it to the caller's tenant. */
  async function create(actor: TenantActor, input: CreateOrganizationInput) {
    const passwordHash = await hashPassword(input.adminPassword);
    const orgId = randomUUID();
    try {
      return await db.withSystem(async (tx) => {
        await tx.query('INSERT INTO organizations (id, type, legal_name, registration_no) VALUES ($1,$2,$3,$4)', [
          orgId, input.type, input.legalName, input.registrationNo,
        ]);
        await tx.query("INSERT INTO tenant_organizations (tenant_id, org_id, relationship) VALUES ($1,$2,'partner')", [actor.tenantId, orgId]);
        const user = await tx.query<{ id: string }>(
          'INSERT INTO users (tenant_id, org_id, email, full_name, password_hash) VALUES (NULL,$1,$2,$3,$4) RETURNING id',
          [orgId, input.adminEmail, input.adminName, passwordHash],
        );
        const userId = user.rows[0]?.id as string;
        await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [userId, input.type]);
        await writeAudit(tx, {
          tenantId: actor.tenantId, actorId: actor.userId, action: 'organization.created', entityType: 'organization',
          entityId: orgId, ip: actor.ip, metadata: { type: input.type },
        });
        return { id: orgId, type: input.type, legalName: input.legalName, registrationNo: input.registrationNo, adminUserId: userId };
      });
    } catch (err) {
      const pg = err as { code?: string; constraint?: string };
      if (pg.code === UNIQUE_VIOLATION && pg.constraint === 'users_email_uidx') throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      if (pg.code === UNIQUE_VIOLATION) throw conflict('ORG_EXISTS', 'An organization with this registration number already exists');
      throw err;
    }
  }

  /** Lists organizations visible to the caller (RLS: those sharing a tenant link). */
  async function list(actor: Actor, type?: string) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query<OrgRow>(
        `SELECT DISTINCT o.id, o.type, o.legal_name, o.registration_no, o.status
         FROM organizations o WHERE ($1::org_type IS NULL OR o.type = $1) ORDER BY o.legal_name`,
        [type ?? null],
      );
      return res.rows.map((o) => ({ id: o.id, type: o.type, legalName: o.legal_name, registrationNo: o.registration_no, status: o.status }));
    });
  }

  /** Platform-only: link an existing organization to another tenant (shared distributors etc.). */
  async function link(tenantId: string, orgId: string, actorId: string, ip: string) {
    return db.withSystem(async (tx) => {
      const org = await tx.query('SELECT 1 FROM organizations WHERE id = $1', [orgId]);
      const tenant = await tx.query('SELECT 1 FROM tenants WHERE id = $1', [tenantId]);
      if (!org.rowCount || !tenant.rowCount) throw notFound('Organization or tenant not found');
      await tx.query("INSERT INTO tenant_organizations (tenant_id, org_id, relationship) VALUES ($1,$2,'partner') ON CONFLICT DO NOTHING", [tenantId, orgId]);
      await writeAudit(tx, { tenantId, actorId, action: 'organization.linked', entityType: 'organization', entityId: orgId, ip });
      return { tenantId, orgId };
    });
  }

  return { create, list, link };
}

export type OrgService = ReturnType<typeof createOrgService>;
