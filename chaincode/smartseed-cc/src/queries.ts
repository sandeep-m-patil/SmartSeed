import type { Context } from 'fabric-contract-api';
import { getCaller, orgHash } from './auth';
import { ErrorCode, SHA256_HEX_LENGTH } from './constants';
import { ContractError } from './errors';
import { listBatchEventIds, listHoldings, requireBatch, requireEvent } from './ledger';

const HEX_PATTERN = new RegExp(`^[a-f0-9]{${SHA256_HEX_LENGTH}}$`);

export async function getBatchJson(ctx: Context, batchId: string): Promise<string> {
  getCaller(ctx);
  const batch = await requireBatch(ctx, batchId);
  // Holders are exposed as pseudonymous hashes only (same hash as event from/to OrgHash).
  const holders = (await listHoldings(ctx, batchId)).map((h) => ({
    holderHash: orgHash(h.tenantId),
    quantityCommitment: h.quantityCommitment,
    sinceSeq: h.sinceSeq,
  }));
  return JSON.stringify({ ...batch, holders });
}

export async function getBatchHistoryJson(ctx: Context, batchId: string): Promise<string> {
  getCaller(ctx);
  await requireBatch(ctx, batchId);
  const ids = await listBatchEventIds(ctx, batchId);
  return JSON.stringify(await Promise.all(ids.map((id) => requireEvent(ctx, id))));
}

export async function getEventJson(ctx: Context, eventId: string): Promise<string> {
  getCaller(ctx);
  return JSON.stringify(await requireEvent(ctx, eventId));
}

/** Compares a caller-supplied recomputed record hash against the committed recordHash. */
export async function verifyRecordHashJson(ctx: Context, eventId: string, hash: string): Promise<string> {
  getCaller(ctx);
  if (!HEX_PATTERN.test(hash)) throw new ContractError(ErrorCode.InvalidInput, 'hash must be 64 hex chars');
  const event = await requireEvent(ctx, eventId);
  return JSON.stringify({ eventId, matches: event.recordHash === hash });
}
