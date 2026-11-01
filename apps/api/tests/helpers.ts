import pg from 'pg';
import pino from 'pino';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { authenticator } from 'otplib';
import type { Role } from '@smartseed/shared';
import { createApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { createDb, type Db } from '../src/db/db';
import { createTokenService, type TokenService } from '../src/auth/tokens';
import { hashPassword } from '../src/auth/password';
import { decryptField } from '../src/lib/crypto';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/smartseed_test';
const APP_URL = process.env.TEST_APP_DATABASE_URL ?? 'postgres://smartseed_app:smartseed_app@localhost:54329/smartseed_test';
export const TEST_PASSWORD = 'Str0ngPassw0rd!x';

export interface Harness {
  app: ReturnType<typeof createApp>;
  db: Db;
  admin: pg.Pool;
  tokens: TokenService;
  config: Config;
  close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: APP_URL,
    JWT_PRIVATE_KEY: await exportPKCS8(privateKey),
    JWT_PUBLIC_KEY: await exportSPKI(publicKey),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    RATE_LIMIT_GLOBAL_MAX: '100000',
    RATE_LIMIT_AUTH_MAX: '100000',
    RATE_LIMIT_REGISTER_MAX: '100000',
    RATE_LIMIT_PUBLIC_MAX: '100000',
    ...overrides,
  });
  const db = createDb(APP_URL);
  const admin = new pg.Pool({ connectionString: ADMIN_URL });
  const tokens = await createTokenService(config);
  const app = createApp({ config, db, tokens, logger: pino({ level: 'silent' }) });
  return { app, db, admin, tokens, config, close: async () => { await db.close(); await admin.end(); } };
}

const RESET_TABLES = [
  'jobs', 'notification_preferences', 'notifications', 'investigation_actions', 'investigation_evidence', 'investigations',
  'alerts', 'risk_scores', 'anomaly_predictions', 'counterfeit_reports', 'qr_scans', 'public_devices', 'qr_codes', 'packages',
  'blocked_attempts', 'blockchain_transactions', 'supply_chain_events', 'inventory_movements', 'transfers',
  'batch_holdings', 'certifications', 'seed_batches', 'products', 'audit_logs', 'refresh_tokens', 'user_roles',
  'users', 'tenant_organizations', 'organizations', 'subscriptions', 'tenants',
];

export async function resetData(h: Harness): Promise<void> {
  await h.admin.query(`TRUNCATE ${RESET_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

interface SeedUser { email?: string; role: Role; tenantId: string | null; orgId?: string | null }

/** Inserts a user directly (bypassing the API). Tenant users get the tenant's own manufacturer org. */
export async function seedUser(h: Harness, u: SeedUser): Promise<{ id: string; email: string }> {
  const email = u.email ?? `${u.role}-${randomBytes(4).toString('hex')}@example.com`;
  let orgId = u.orgId ?? null;
  if (!orgId && u.tenantId) {
    const self = await h.admin.query<{ org_id: string }>(
      "SELECT org_id FROM tenant_organizations WHERE tenant_id = $1 AND relationship = 'self'", [u.tenantId]);
    orgId = self.rows[0]?.org_id ?? null;
  }
  const res = await h.admin.query<{ id: string }>(
    'INSERT INTO users (tenant_id, org_id, email, full_name, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [u.tenantId, orgId, email, `Test ${u.role}`, await hashPassword(TEST_PASSWORD)],
  );
  const id = res.rows[0]?.id as string;
  await h.admin.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [id, u.role]);
  return { id, email };
}

export async function seedTenant(h: Harness, status: 'pending' | 'active' | 'suspended' = 'active'): Promise<string> {
  const slug = `t-${randomBytes(4).toString('hex')}`;
  const res = await h.admin.query<{ id: string }>(
    'INSERT INTO tenants (name, slug, status) VALUES ($1,$2,$3) RETURNING id', [slug, slug, status]);
  const tenantId = res.rows[0]?.id as string;
  const org = await h.admin.query<{ id: string }>(
    "INSERT INTO organizations (id, type, legal_name, registration_no) VALUES (gen_random_uuid(), 'manufacturer', $1, $2) RETURNING id",
    [slug, `TENANT-${tenantId}`]);
  await h.admin.query(
    "INSERT INTO tenant_organizations (tenant_id, org_id, relationship) VALUES ($1,$2,'self')", [tenantId, org.rows[0]?.id]);
  return tenantId;
}

/** Mints an access token straight from the token service; the org id is read from the user row. */
export async function tokenFor(h: Harness, userId: string, tenantId: string | null, roles: Role[]): Promise<string> {
  const row = await h.admin.query<{ org_id: string | null }>('SELECT org_id FROM users WHERE id = $1', [userId]);
  return h.tokens.signAccess({ sub: userId, tid: tenantId, oid: row.rows[0]?.org_id ?? null, roles, mfa: true });
}

export interface Party {
  orgId: string;
  user: { id: string; email: string };
  token: string;
}

/** Creates a partner organization linked to the tenant, with one user and an access token. */
export async function seedPartner(h: Harness, tenantId: string, type: 'distributor' | 'wholesaler' | 'retailer'): Promise<Party> {
  const org = await h.admin.query<{ id: string }>(
    'INSERT INTO organizations (id, type, legal_name, registration_no) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
    [type, `${type} ${randomBytes(3).toString('hex')}`, `REG-${randomBytes(6).toString('hex')}`]);
  const orgId = org.rows[0]?.id as string;
  await h.admin.query("INSERT INTO tenant_organizations (tenant_id, org_id, relationship) VALUES ($1,$2,'partner')", [tenantId, orgId]);
  const user = await seedUser(h, { role: type, tenantId: null, orgId });
  return { orgId, user, token: await tokenFor(h, user.id, null, [type]) };
}

/** Manufacturer-side party for a tenant. */
export async function seedManufacturer(h: Harness, tenantId: string): Promise<Party> {
  const user = await seedUser(h, { role: 'manufacturer', tenantId });
  const row = await h.admin.query<{ org_id: string }>('SELECT org_id FROM users WHERE id = $1', [user.id]);
  return { orgId: row.rows[0]?.org_id as string, user, token: await tokenFor(h, user.id, tenantId, ['manufacturer']) };
}

/** Completes enrollment + verification for a privileged user and returns the session tokens. */
export async function loginWithMfa(h: Harness, email: string): Promise<{ accessToken: string; refreshToken: string }> {
  const login = await request(h.app).post('/v1/auth/login').send({ email, password: TEST_PASSWORD });
  const { mfaToken } = login.body.data;
  const enroll = await request(h.app).post('/v1/auth/mfa/enroll').send({ mfaToken });
  const code = authenticator.generate(enroll.body.data.secret);
  const verify = await request(h.app).post('/v1/auth/mfa/verify').send({ mfaToken, code });
  return verify.body.data;
}

export async function currentTotp(h: Harness, userId: string): Promise<string> {
  const row = await h.admin.query<{ mfa_secret_enc: string }>('SELECT mfa_secret_enc FROM users WHERE id = $1', [userId]);
  return authenticator.generate(decryptField(row.rows[0]?.mfa_secret_enc as string, h.config.FIELD_ENCRYPTION_KEY));
}
