import type { Context } from 'fabric-contract-api';
import { sha256Hex } from './canonical';
import {
  COMMITMENT_SEPARATOR,
  ErrorCode,
  MAX_QUANTITY_DIGITS,
  PDC_KEY_HOLD,
  PDC_KEY_QTY,
  PDC_KEY_SOLD,
  PDC_PREFIX,
  TRANSIENT_QUANTITY,
  TRANSIENT_SALT,
} from './constants';
import { ContractError } from './errors';

export interface PrivateQuantity {
  quantity: number;
  salt: string;
}

const QUANTITY_PATTERN = new RegExp(`^\\d{1,${MAX_QUANTITY_DIGITS}}$`);
const decoder = new TextDecoder();

/** commitment = SHA-256("<quantity>|<salt>") as lowercase hex. */
export function quantityCommitment(quantity: number | string, salt: string): string {
  return sha256Hex(`${quantity}${COMMITMENT_SEPARATOR}${salt}`);
}

export const collectionFor = (tenantId: string): string => `${PDC_PREFIX}${tenantId}`;

function transientText(ctx: Context, name: string): string | undefined {
  const value = ctx.stub.getTransient().get(name);
  return value === undefined ? undefined : decoder.decode(value);
}

/**
 * Reads the optional plaintext quantity from transient data and checks it opens `commitment`.
 * Returns undefined when no quantity was supplied.
 */
export function readTransientQuantity(ctx: Context, commitment: string): PrivateQuantity | undefined {
  const rawQuantity = transientText(ctx, TRANSIENT_QUANTITY);
  if (rawQuantity === undefined) return undefined;
  const salt = transientText(ctx, TRANSIENT_SALT);
  if (!QUANTITY_PATTERN.test(rawQuantity) || !salt) {
    throw new ContractError(ErrorCode.InvalidInput, 'transient quantity must be an integer with a salt');
  }
  if (quantityCommitment(rawQuantity, salt) !== commitment) {
    throw new ContractError(ErrorCode.CommitmentMismatch, 'transient quantity does not open the commitment');
  }
  return { quantity: Number(rawQuantity), salt };
}

export async function putPrivate(ctx: Context, tenantId: string, key: string, value: unknown): Promise<void> {
  await ctx.stub.putPrivateData(collectionFor(tenantId), key, Buffer.from(JSON.stringify(value), 'utf8'));
}

export async function getPrivate<T>(ctx: Context, tenantId: string, key: string): Promise<T | undefined> {
  const raw = await ctx.stub.getPrivateData(collectionFor(tenantId), key);
  if (!raw || raw.length === 0) return undefined;
  return JSON.parse(Buffer.from(raw).toString('utf8')) as T;
}

export const qtyKey = (batchId: string, eventId: string): string => `${PDC_KEY_QTY}${batchId}:${eventId}`;
export const holdKey = (batchId: string): string => `${PDC_KEY_HOLD}${batchId}`;
export const soldKey = (batchId: string): string => `${PDC_KEY_SOLD}${batchId}`;
