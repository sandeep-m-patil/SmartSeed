import type { CreateUserInput } from '@smartseed/shared';
import type { Db } from '../db/db';
import { conflict } from '../errors';
import { writeAudit } from '../audit/audit';
import { hashPassword } from '../auth/password';
import { decodeCursor, toPage } from '../lib/pagination';
import { assertWithinLimit } from '../billing/service';

const UNIQUE_VIOLATION = '23505';

interface UserListRow {
  id: string; email: string; full_name: string; status: string; mfa_enabled: boolean; created_at: Date; roles: string[];
}

export interface Actor { userId: string; tenantId: string; ip: string }

export function createUserService(db: Db) {
  async function create(actor: Actor, input: CreateUserInput) {
    const passwordHash = await hashPassword(input.password);
    try {
      return await db.withTenant(actor.tenantId, async (tx) => {
        await assertWithinLimit(tx, actor.tenantId, 'users');
        const res = await tx.query<{ id: string }>(
          `INSERT INTO users (tenant_id, org_id, email, full_name, password_hash)
           SELECT $1, org_id, $2, $3, $4 FROM tenant_organizations WHERE tenant_id = $1 AND relationship = 'self' RETURNING id`,
          [actor.tenantId, input.email, input.fullName, passwordHash]);
        const id = res.rows[0]?.id as string;
        await tx.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [id, input.role]);
        await writeAudit(tx, {
          tenantId: actor.tenantId, actorId: actor.userId, action: 'user.created', entityType: 'user', entityId: id,
          ip: actor.ip, metadata: { role: input.role },
        });
        return { id, email: input.email, fullName: input.fullName, role: input.role };
      });
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      throw err;
    }
  }

  async function list(tenantId: string, q: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withTenant(tenantId, async (tx) =>
      (await tx.query<UserListRow>(
        `SELECT u.id, u.email, u.full_name, u.status, u.mfa_enabled, u.created_at,
                COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
         FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
         WHERE ($1::timestamptz IS NULL OR (u.created_at, u.id) < ($1, $2::uuid))
         GROUP BY u.id ORDER BY u.created_at DESC, u.id DESC LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((r) => ({
        id: r.id, email: r.email, fullName: r.full_name, status: r.status, mfaEnabled: r.mfa_enabled, roles: r.roles, createdAt: r.created_at,
      })),
    };
  }

  return { create, list };
}

export type UserService = ReturnType<typeof createUserService>;
