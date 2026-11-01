import { createPrivateKey, createPublicKey, createSign, createVerify, type KeyObject } from 'node:crypto';
import { sha256Hex } from '../lib/crypto';

/**
 * Application-level signature over a record hash (second layer on top of the Fabric transaction
 * signature). Production deployments back this with a KMS/HSM implementation of the same interface.
 */
export interface AppSigner {
  keyId: string;
  sign(recordHash: string): Promise<string>;
}

/** Dev/staging signer holding an ECDSA P-256 PEM from the environment. Never used in the browser or mobile app. */
export class EnvKeySigner implements AppSigner {
  readonly keyId: string;
  private readonly key: KeyObject;

  constructor(privateKeyPem: string) {
    this.key = createPrivateKey(privateKeyPem);
    this.keyId = sha256Hex(createPublicKey(this.key).export({ type: 'spki', format: 'der' }).toString('base64')).slice(0, 16);
  }

  async sign(recordHash: string): Promise<string> {
    return createSign('SHA256').update(recordHash).sign(this.key, 'base64');
  }
}

export function verifySignature(publicKeyPem: string, recordHash: string, signatureB64: string): boolean {
  return createVerify('SHA256').update(recordHash).verify(createPublicKey(publicKeyPem), signatureB64, 'base64');
}

/** Short, ledger-safe reference to a stored signature (matches the chaincode ref pattern). */
export const signatureRef = (keyId: string, signature: string): string => `sig:${keyId}:${sha256Hex(signature).slice(0, 24)}`;
