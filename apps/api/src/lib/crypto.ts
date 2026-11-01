import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TOKEN_BYTES = 32;

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

/** AES-256-GCM; output is base64(iv | tag | ciphertext). */
export function encryptField(plain: string, keyBase64: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptField(payload: string, keyBase64: string): string {
  const raw = Buffer.from(payload, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), raw.subarray(0, IV_BYTES));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + 16));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + 16)), decipher.final()]).toString('utf8');
}
