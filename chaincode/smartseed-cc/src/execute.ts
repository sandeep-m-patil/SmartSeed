import type { Context } from 'fabric-contract-api';
import type { ZodType } from 'zod';
import { getCaller, orgHash, requireRole } from './auth';
import { canonicalHash } from './canonical';
import { ErrorCode, KEY_BATCH, KEY_PRODUCT, ResultStatus, Role } from './constants';
import { ContractError } from './errors';
import { batchIndexKey, getEvent, putEventOnce, putJson, requireEvent, txTimestampMs } from './ledger';
import type { EventBaseInput } from './schemas';
import type { Caller, EventDraft, EventRecord, HandlerContext, TxResult } from './types';

export interface WriteSpec<T extends EventBaseInput> {
  fn: string;
  roles: readonly Role[];
  schema: ZodType<T, any, unknown>;
  handler: (hc: HandlerContext, input: T) => Promise<EventDraft>;
}

function parseInput<T>(raw: string, schema: ZodType<T, any, unknown>): T {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ContractError(ErrorCode.InvalidInput, 'input is not valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
    throw new ContractError(ErrorCode.InvalidInput, `invalid fields: ${paths}`);
  }
  return parsed.data;
}

function idempotentResult(existing: EventRecord, payloadHash: string): TxResult {
  if (existing.payloadHash !== payloadHash) {
    throw new ContractError(
      ErrorCode.DuplicateEventMismatch,
      `eventId ${existing.eventId} already committed with a different payload`,
    );
  }
  const result: TxResult = { status: ResultStatus.AlreadyCommitted, eventId: existing.eventId };
  if (existing.seq !== undefined) result.seq = existing.seq;
  return result;
}

async function assertCorrection(ctx: Context, input: EventBaseInput): Promise<void> {
  if (!input.corrects) return;
  const target = await requireEvent(ctx, input.corrects).catch(() => {
    throw new ContractError(ErrorCode.InvalidCorrection, `corrected event ${input.corrects} not found`);
  });
  if (input.batchId !== undefined && target.batchId !== input.batchId) {
    throw new ContractError(ErrorCode.InvalidCorrection, 'corrected event belongs to a different batch');
  }
}

function buildRecord(draft: EventDraft, input: EventBaseInput, meta: { caller: Caller; now: number; hash: string }) {
  const record: EventRecord = {
    ...draft.fields,
    eventId: input.eventId,
    eventType: draft.eventType,
    ts: meta.now,
    payloadHash: meta.hash,
    recordHash: input.recordHash,
    actorOrgHash: orgHash(meta.caller.tenantId),
  };
  if (draft.batch) {
    draft.batch.eventSeq += 1;
    record.batchId = draft.batch.batchId;
    record.seq = draft.batch.eventSeq;
  }
  for (const key of ['dbRecordRef', 'signatureRef', 'corrects'] as const) {
    if (input[key] !== undefined) record[key] = input[key] as string;
  }
  return record;
}

async function persist(ctx: Context, draft: EventDraft, record: EventRecord): Promise<void> {
  await putEventOnce(ctx, record);
  if (draft.batch) {
    await putJson(ctx, KEY_BATCH + draft.batch.batchId, draft.batch);
    await ctx.stub.putState(batchIndexKey(ctx, draft.batch.batchId, draft.batch.eventSeq), Buffer.from(record.eventId));
  }
  if (draft.product) await putJson(ctx, KEY_PRODUCT + draft.product.productId, draft.product);
  for (const write of draft.writes ?? []) await putJson(ctx, write.key, write.value);
  for (const key of draft.deletes ?? []) await ctx.stub.deleteState(key);
}

/** Common pipeline for every state-changing function: authz, validation, idempotency, append-only write. */
export async function execute<T extends EventBaseInput>(ctx: Context, raw: string, spec: WriteSpec<T>): Promise<string> {
  const caller = getCaller(ctx);
  requireRole(caller, spec.roles);
  const input = parseInput(raw, spec.schema);
  const hash = canonicalHash({ fn: spec.fn, tenantId: caller.tenantId, input });
  const existing = await getEvent(ctx, input.eventId);
  if (existing) return JSON.stringify(idempotentResult(existing, hash));
  await assertCorrection(ctx, input);
  const now = txTimestampMs(ctx);
  const draft = await spec.handler({ ctx, caller, now }, input);
  const record = buildRecord(draft, input, { caller, now, hash });
  await persist(ctx, draft, record);
  const result: TxResult = { status: ResultStatus.Committed, eventId: record.eventId };
  if (record.seq !== undefined) result.seq = record.seq;
  return JSON.stringify(result);
}
