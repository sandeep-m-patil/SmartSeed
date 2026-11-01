import type { Context } from 'fabric-contract-api';
import { canonicalize } from './canonical';
import {
  BATCH_EVENT_INDEX,
  ErrorCode,
  KEY_BATCH,
  KEY_EVENT,
  KEY_HOLDING,
  KEY_PENDING,
  KEY_RANGE_END,
  KEY_SEPARATOR,
  KEY_PRODUCT,
  MS_PER_SECOND,
  NANOS_PER_MS,
  SEQ_PAD_WIDTH,
} from './constants';
import { ContractError } from './errors';
import type { BatchState, EventRecord, HoldingState, PendingTransfer, ProductState } from './types';

export async function getJson<T>(ctx: Context, key: string): Promise<T | undefined> {
  const raw = await ctx.stub.getState(key);
  if (!raw || raw.length === 0) return undefined;
  return JSON.parse(Buffer.from(raw).toString('utf8')) as T;
}

async function requireJson<T>(ctx: Context, key: string, label: string): Promise<T> {
  const value = await getJson<T>(ctx, key);
  if (value === undefined) throw new ContractError(ErrorCode.NotFound, `${label} not found`);
  return value;
}

/** Deterministic (canonical) serialisation so all endorsers write identical bytes. */
export async function putJson(ctx: Context, key: string, value: unknown): Promise<void> {
  await ctx.stub.putState(key, Buffer.from(canonicalize(value), 'utf8'));
}

export function txTimestampMs(ctx: Context): number {
  const { seconds, nanos } = ctx.stub.getTxTimestamp();
  return Number(String(seconds ?? 0)) * MS_PER_SECOND + Math.floor((nanos ?? 0) / NANOS_PER_MS);
}

export const getProduct = (ctx: Context, id: string) => getJson<ProductState>(ctx, KEY_PRODUCT + id);
export const getBatch = (ctx: Context, id: string) => getJson<BatchState>(ctx, KEY_BATCH + id);
export const getEvent = (ctx: Context, id: string) => getJson<EventRecord>(ctx, KEY_EVENT + id);

export const requireProduct = (ctx: Context, id: string) =>
  requireJson<ProductState>(ctx, KEY_PRODUCT + id, `product ${id}`);
export const requireBatch = (ctx: Context, id: string) => requireJson<BatchState>(ctx, KEY_BATCH + id, `batch ${id}`);
export const requireEvent = (ctx: Context, id: string) => requireJson<EventRecord>(ctx, KEY_EVENT + id, `event ${id}`);

/** EVENT records are append-only: refuse to PutState over an existing EVENT key. */
export async function putEventOnce(ctx: Context, event: EventRecord): Promise<void> {
  const key = KEY_EVENT + event.eventId;
  const existing = await ctx.stub.getState(key);
  if (existing && existing.length > 0) {
    throw new ContractError(ErrorCode.EventImmutable, `event ${event.eventId} already exists and is immutable`);
  }
  await putJson(ctx, key, event);
}

export function batchIndexKey(ctx: Context, batchId: string, seq: number): string {
  return ctx.stub.createCompositeKey(BATCH_EVENT_INDEX, [batchId, String(seq).padStart(SEQ_PAD_WIDTH, '0')]);
}

/** Event ids for a batch in sequence order (composite keys sort lexicographically; seq is zero-padded). */
export async function listBatchEventIds(ctx: Context, batchId: string): Promise<string[]> {
  const iterator = await ctx.stub.getStateByPartialCompositeKey(BATCH_EVENT_INDEX, [batchId]);
  const ids: string[] = [];
  try {
    for (let item = await iterator.next(); !item.done; item = await iterator.next()) {
      ids.push(Buffer.from(item.value.value).toString('utf8'));
    }
  } finally {
    await iterator.close();
  }
  return ids;
}

export const holdingKey = (batchId: string, tenantId: string): string =>
  `${KEY_HOLDING}${batchId}${KEY_SEPARATOR}${tenantId}`;
export const pendingKey = (batchId: string, transferEventId: string): string =>
  `${KEY_PENDING}${batchId}${KEY_SEPARATOR}${transferEventId}`;

export const getHolding = (ctx: Context, batchId: string, tenantId: string) =>
  getJson<HoldingState>(ctx, holdingKey(batchId, tenantId));
export const getPending = (ctx: Context, batchId: string, transferEventId: string) =>
  getJson<PendingTransfer>(ctx, pendingKey(batchId, transferEventId));

/** The caller must currently hold (part of) the batch. */
export async function requireHolding(ctx: Context, batchId: string, tenantId: string): Promise<HoldingState> {
  const holding = await getHolding(ctx, batchId, tenantId);
  if (!holding) throw new ContractError(ErrorCode.NotHolder, `caller does not hold batch ${batchId}`);
  return holding;
}

export async function requirePending(ctx: Context, batchId: string, transferEventId: string): Promise<PendingTransfer> {
  const pending = await getPending(ctx, batchId, transferEventId);
  if (!pending) throw new ContractError(ErrorCode.NoPendingTransfer, `no pending transfer ${transferEventId}`);
  return pending;
}

export async function listHoldings(ctx: Context, batchId: string): Promise<HoldingState[]> {
  const start = `${KEY_HOLDING}${batchId}${KEY_SEPARATOR}`;
  const end = `${KEY_HOLDING}${batchId}${KEY_RANGE_END}`;
  const iterator = await ctx.stub.getStateByRange(start, end);
  const holdings: HoldingState[] = [];
  try {
    for (let item = await iterator.next(); !item.done; item = await iterator.next()) {
      holdings.push(JSON.parse(Buffer.from(item.value.value).toString('utf8')) as HoldingState);
    }
  } finally {
    await iterator.close();
  }
  return holdings;
}
