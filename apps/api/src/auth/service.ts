import { requiresMfa, type LoginInput } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import type { Config } from '../config';
import { AppError, forbidden, unauthorized, conflict, badRequest } from '../errors';
import { writeAudit } from '../audit/audit';
import { decryptField, encryptField, sha256Hex } from '../lib/crypto';
import { canAuthenticate, findAuthUserByEmail, findAuthUserById, isLocked, type AuthUser } from './authUsers';
import { generateMfaSecret, matchStep, otpauthUrl } from './mfa';
import { verifyAgainstDummy, verifyPassword } from './password';
import { issueSession, type Session } from './sessions';
import type { TokenService } from './tokens';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const invalidCredentials = () => unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

export type LoginResult =
  | { kind: 'session'; session: Session }
  | { kind: 'mfa'; mfaToken: string; enrolled: boolean };

export interface AuthService {
  login(input: LoginInput, ip: string): Promise<LoginResult>;
  enrollMfa(mfaToken: string): Promise<{ secret: string; otpauthUrl: string }>;
  verifyMfa(mfaToken: string, code: string, ip: string): Promise<Session>;
  refresh(refreshToken: string, ip: string): Promise<Session>;
  logout(refreshToken: string): Promise<void>;
}

interface Deps {
  db: Db;
  tokens: TokenService;
  config: Config;
}

type MfaOutcome = { ok: true; session: Session } | { ok: false };
type RefreshOutcome = { ok: true; session: Session } | { ok: false; reason: string };

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  mfa: boolean;
  used_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
}

async function recordFailure(tx: Tx, user: AuthUser, reason: string, ip: string): Promise<void> {
  await tx.query(
    `UPDATE users SET failed_attempts = failed_attempts + 1,
       locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
     WHERE id = $1`,
    [user.id, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES],
  );
  await writeAudit(tx, { tenantId: user.tenant_id, actorId: user.id, action: 'auth.login_failed', ip, metadata: { reason } });
}

export function createAuthService(deps: Deps): AuthService {
  const { db, tokens, config } = deps;
  const sessionDeps = { tokens, config };
  const subjectOf = (user: AuthUser, mfa: boolean) => ({ id: user.id, tenantId: user.tenant_id, orgId: user.org_id, roles: user.roles, mfa });

  async function mintMfaOrSession(user: AuthUser, ip: string): Promise<LoginResult> {
    if (requiresMfa(user.roles)) {
      return { kind: 'mfa', mfaToken: await tokens.signMfa(user.id), enrolled: user.mfa_enabled };
    }
    const session = await db.withSystem(async (tx) => {
      await tx.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
      await writeAudit(tx, { tenantId: user.tenant_id, actorId: user.id, action: 'auth.login', ip });
      return issueSession(tx, sessionDeps, subjectOf(user, false));
    });
    return { kind: 'session', session };
  }

  async function login(input: LoginInput, ip: string): Promise<LoginResult> {
    const user = await db.withSystem((tx) => findAuthUserByEmail(tx, input.email));
    if (!user || isLocked(user)) {
      await verifyAgainstDummy(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.password_hash, input.password))) {
      await db.withSystem((tx) => recordFailure(tx, user, 'bad_password', ip));
      throw invalidCredentials();
    }
    if (user.status !== 'active') throw invalidCredentials();
    if (!canAuthenticate(user)) throw forbidden('TENANT_NOT_ACTIVE', 'This organization is not active');
    return mintMfaOrSession(user, ip);
  }

  async function verifyMfaToken(mfaToken: string): Promise<string> {
    try {
      return await tokens.verifyMfa(mfaToken);
    } catch {
      throw unauthorized('INVALID_MFA_TOKEN', 'MFA session expired; sign in again');
    }
  }

  async function enrollMfa(mfaToken: string) {
    const userId = await verifyMfaToken(mfaToken);
    return db.withSystem(async (tx) => {
      const user = await findAuthUserById(tx, userId);
      if (!user || !canAuthenticate(user)) throw invalidCredentials();
      if (user.mfa_enabled) throw conflict('MFA_ALREADY_ENABLED', 'MFA is already enabled for this account');
      const secret = generateMfaSecret();
      const encrypted = encryptField(secret, config.FIELD_ENCRYPTION_KEY);
      await tx.query('UPDATE users SET mfa_secret_enc = $2 WHERE id = $1', [user.id, encrypted]);
      return { secret, otpauthUrl: otpauthUrl(user.email, secret) };
    });
  }

  async function acceptStep(tx: Tx, user: AuthUser, step: number): Promise<boolean> {
    const res = await tx.query(
      `UPDATE users SET mfa_last_step = $2, mfa_enabled = true, failed_attempts = 0, locked_until = NULL, last_login_at = now()
       WHERE id = $1 AND mfa_last_step < $2 RETURNING id`,
      [user.id, step],
    );
    return res.rowCount === 1;
  }

  async function checkMfaCode(tx: Tx, user: AuthUser, code: string, ip: string): Promise<MfaOutcome> {
    if (!user.mfa_secret_enc) throw badRequest('MFA_NOT_ENROLLED', 'Start MFA enrollment first');
    const step = matchStep(code, decryptField(user.mfa_secret_enc, config.FIELD_ENCRYPTION_KEY));
    if (step === null || !(await acceptStep(tx, user, step))) {
      await recordFailure(tx, user, step === null ? 'bad_mfa_code' : 'mfa_replay', ip);
      return { ok: false };
    }
    await writeAudit(tx, { tenantId: user.tenant_id, actorId: user.id, action: 'auth.login_mfa', ip });
    return { ok: true, session: await issueSession(tx, sessionDeps, subjectOf(user, true)) };
  }

  async function verifyMfa(mfaToken: string, code: string, ip: string): Promise<Session> {
    const userId = await verifyMfaToken(mfaToken);
    const outcome = await db.withSystem(async (tx): Promise<MfaOutcome> => {
      const user = await findAuthUserById(tx, userId);
      if (!user || !canAuthenticate(user) || isLocked(user)) return { ok: false };
      return checkMfaCode(tx, user, code, ip);
    });
    if (!outcome.ok) throw unauthorized('INVALID_MFA_CODE', 'Invalid or expired code');
    return outcome.session;
  }

  async function rotate(tx: Tx, hash: string, ip: string): Promise<RefreshOutcome> {
    const found = await tx.query<RefreshRow>(
      'SELECT id, user_id, family_id, mfa, used_at, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
      [hash],
    );
    const row = found.rows[0];
    if (!row || row.revoked_at || row.expires_at < new Date()) return { ok: false, reason: 'unknown_or_expired' };
    const user = await findAuthUserById(tx, row.user_id);
    if (row.used_at || !user || !canAuthenticate(user)) {
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
      const action = row.used_at ? 'auth.refresh_reuse_detected' : 'auth.refresh_denied';
      if (user) await writeAudit(tx, { tenantId: user.tenant_id, actorId: user.id, action, ip });
      return { ok: false, reason: action };
    }
    await tx.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [row.id]);
    return { ok: true, session: await issueSession(tx, sessionDeps, subjectOf(user, row.mfa), row.family_id) };
  }

  async function refresh(refreshToken: string, ip: string): Promise<Session> {
    // The outcome is returned (not thrown) so family revocation commits before we reject.
    const outcome = await db.withSystem((tx) => rotate(tx, sha256Hex(refreshToken), ip));
    if (!outcome.ok) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired; sign in again');
    return outcome.session;
  }

  async function logout(refreshToken: string): Promise<void> {
    await db.withSystem((tx) =>
      tx.query(
        `UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL AND family_id =
           (SELECT family_id FROM refresh_tokens WHERE token_hash = $1)`,
        [sha256Hex(refreshToken)],
      ),
    );
  }

  return { login, enrollMfa, verifyMfa, refresh, logout };
}
