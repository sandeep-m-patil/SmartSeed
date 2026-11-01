import type { Role } from '@smartseed/shared';
import type { Tx } from '../db/db';

export interface AuthUser {
  id: string;
  tenant_id: string | null;
  org_id: string | null;
  email: string;
  password_hash: string;
  status: 'active' | 'disabled';
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_last_step: string; // bigint arrives as string
  failed_attempts: number;
  locked_until: Date | null;
  tenant_status: 'pending' | 'active' | 'suspended' | null;
  roles: Role[];
}

const SELECT_USER = `
  SELECT u.id, u.tenant_id, u.org_id, u.email, u.password_hash, u.status, u.mfa_enabled, u.mfa_secret_enc,
         u.mfa_last_step, u.failed_attempts, u.locked_until, t.status AS tenant_status,
         COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
  FROM users u
  LEFT JOIN tenants t ON t.id = u.tenant_id
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id`;

export async function findAuthUserByEmail(tx: Tx, email: string): Promise<AuthUser | null> {
  const res = await tx.query<AuthUser>(`${SELECT_USER} WHERE lower(u.email) = $1 GROUP BY u.id, t.status`, [email.toLowerCase()]);
  return res.rows[0] ?? null;
}

export async function findAuthUserById(tx: Tx, id: string): Promise<AuthUser | null> {
  const res = await tx.query<AuthUser>(`${SELECT_USER} WHERE u.id = $1 GROUP BY u.id, t.status`, [id]);
  return res.rows[0] ?? null;
}

export const isLocked = (u: AuthUser, now = new Date()): boolean => u.locked_until !== null && u.locked_until > now;

/** True when the account may hold a session (user enabled, tenant active if any). */
export const canAuthenticate = (u: AuthUser): boolean =>
  u.status === 'active' && (u.tenant_id === null || u.tenant_status === 'active');
