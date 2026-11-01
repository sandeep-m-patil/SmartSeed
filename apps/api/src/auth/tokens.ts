import { SignJWT, jwtVerify, importPKCS8, importSPKI, type CryptoKey } from 'jose';
import type { Role } from '@smartseed/shared';
import type { Config } from '../config';

const ALG = 'ES256';
const MFA_TOKEN_TTL_SECONDS = 300;

export interface AccessClaims {
  sub: string;
  tid: string | null;
  oid: string | null;
  roles: Role[];
  mfa: boolean;
}

export interface TokenService {
  signAccess(claims: AccessClaims): Promise<string>;
  verifyAccess(token: string): Promise<AccessClaims>;
  signMfa(userId: string): Promise<string>;
  verifyMfa(token: string): Promise<string>;
}

export async function createTokenService(config: Pick<Config, 'JWT_PRIVATE_KEY' | 'JWT_PUBLIC_KEY' | 'JWT_ISSUER' | 'ACCESS_TTL_SECONDS'>): Promise<TokenService> {
  const privateKey: CryptoKey = await importPKCS8(config.JWT_PRIVATE_KEY, ALG);
  const publicKey: CryptoKey = await importSPKI(config.JWT_PUBLIC_KEY, ALG);
  const issuer = config.JWT_ISSUER;

  const sign = (scope: string, sub: string, ttl: number, extra: Record<string, unknown> = {}) =>
    new SignJWT({ scope, ...extra })
      .setProtectedHeader({ alg: ALG })
      .setSubject(sub).setIssuer(issuer).setIssuedAt().setExpirationTime(`${ttl}s`)
      .sign(privateKey);

  async function verify(token: string, scope: string) {
    const { payload } = await jwtVerify(token, publicKey, { issuer, algorithms: [ALG] });
    if (payload.scope !== scope || !payload.sub) throw new Error('wrong token scope');
    return payload;
  }

  return {
    signAccess: (c) => sign('access', c.sub, config.ACCESS_TTL_SECONDS, { tid: c.tid, oid: c.oid, roles: c.roles, mfa: c.mfa }),
    async verifyAccess(token) {
      const p = await verify(token, 'access');
      return { sub: p.sub as string, tid: (p.tid as string | null) ?? null, oid: (p.oid as string | null) ?? null, roles: p.roles as Role[], mfa: p.mfa === true };
    },
    signMfa: (userId) => sign('mfa', userId, MFA_TOKEN_TTL_SECONDS),
    verifyMfa: async (token) => (await verify(token, 'mfa')).sub as string,
  };
}
