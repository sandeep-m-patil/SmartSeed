import { randomUUID } from 'node:crypto';
import type { Role } from '@smartseed/shared';
import type { Tx } from '../db/db';
import type { Config } from '../config';
import { randomToken, sha256Hex } from '../lib/crypto';
import type { TokenService } from './tokens';

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionSubject {
  id: string;
  tenantId: string | null;
  orgId: string | null;
  roles: Role[];
  mfa: boolean;
}

interface SessionDeps {
  tokens: TokenService;
  config: Pick<Config, 'ACCESS_TTL_SECONDS' | 'REFRESH_TTL_DAYS'>;
}

const MS_PER_DAY = 86_400_000;

export async function issueSession(
  tx: Tx,
  deps: SessionDeps,
  subject: SessionSubject,
  familyId: string = randomUUID(),
): Promise<Session> {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + deps.config.REFRESH_TTL_DAYS * MS_PER_DAY);
  await tx.query(
    'INSERT INTO refresh_tokens (user_id, family_id, token_hash, mfa, expires_at) VALUES ($1,$2,$3,$4,$5)',
    [subject.id, familyId, sha256Hex(refreshToken), subject.mfa, expiresAt],
  );
  const accessToken = await deps.tokens.signAccess({
    sub: subject.id, tid: subject.tenantId, oid: subject.orgId, roles: subject.roles, mfa: subject.mfa,
  });
  return { accessToken, refreshToken, expiresIn: deps.config.ACCESS_TTL_SECONDS };
}
