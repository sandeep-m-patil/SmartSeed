// Prints dev-only secrets for .env. Production secrets come from the secret manager.
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
import { randomBytes } from 'node:crypto';

const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');
console.log(`JWT_PRIVATE_KEY=${oneLine(await exportPKCS8(privateKey))}`);
console.log(`JWT_PUBLIC_KEY=${oneLine(await exportSPKI(publicKey))}`);
console.log(`FIELD_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
