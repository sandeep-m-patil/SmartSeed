import { describe, expect, it } from 'vitest';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { randomBytes } from 'node:crypto';
import { hasPermission, requiresMfa, passwordSchema } from '@smartseed/shared';
import { decryptField, encryptField } from '../src/lib/crypto';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { createTokenService } from '../src/auth/tokens';
import { decodeCursor, encodeCursor } from '../src/lib/pagination';
import { loadConfig } from '../src/config';

describe('field encryption', () => {
  const key = randomBytes(32).toString('base64');
  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptField('secret', key);
    expect(decryptField(a, key)).toBe('secret');
    expect(encryptField('secret', key)).not.toBe(a);
  });
  it('fails to decrypt tampered ciphertext', () => {
    const raw = Buffer.from(encryptField('secret', key), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptField(raw.toString('base64'), key)).toThrow();
  });
});

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('Str0ngPassw0rd!x');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'Str0ngPassw0rd!x')).toBe(true);
    expect(await verifyPassword(hash, 'nope')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  it('enforces the password policy', () => {
    expect(passwordSchema.safeParse('short1A').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase1234').success).toBe(false);
    expect(passwordSchema.safeParse('Str0ngPassw0rd!x').success).toBe(true);
  });
});

describe('rbac helpers', () => {
  it('denies by default and grants per matrix', () => {
    expect(hasPermission(['retailer'], 'user:read')).toBe(false);
    expect(hasPermission(['company_admin'], 'user:read')).toBe(true);
    expect(hasPermission([], 'user:read')).toBe(false);
  });
  it('requires MFA for privileged roles only', () => {
    expect(requiresMfa(['platform_admin'])).toBe(true);
    expect(requiresMfa(['manufacturer'])).toBe(false);
  });
});

describe('config', () => {
  it('rejects access token lifetimes over 15 minutes', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', JWT_PRIVATE_KEY: 'k', JWT_PUBLIC_KEY: 'k', FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ACCESS_TTL_SECONDS: '3600' }))
      .toThrow(/ACCESS_TTL_SECONDS/);
  });
  it('rejects a short encryption key', () => {
    expect(() => loadConfig({ DATABASE_URL: 'x', JWT_PRIVATE_KEY: 'k', JWT_PUBLIC_KEY: 'k', FIELD_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/FIELD_ENCRYPTION_KEY/);
  });
});

describe('tokens and cursors', () => {
  it('expires access tokens according to config and keeps scopes separate', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    const svc = await createTokenService({
      JWT_PRIVATE_KEY: await exportPKCS8(privateKey), JWT_PUBLIC_KEY: await exportSPKI(publicKey), JWT_ISSUER: 'smartseed', ACCESS_TTL_SECONDS: 60,
    });
    const access = await svc.signAccess({ sub: 'u1', tid: null, oid: null, roles: ['auditor'], mfa: true });
    expect((await svc.verifyAccess(access)).roles).toEqual(['auditor']);
    await expect(svc.verifyMfa(access)).rejects.toThrow();
  });
  it('decodes only well-formed cursors', () => {
    const c = { createdAt: new Date().toISOString(), id: 'abc' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor('garbage')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
