import { orgHash } from '../auth';
import { ErrorCode, EventType } from '../constants';
import { ContractError } from '../errors';
import { getHolding, getPending, holdingKey, pendingKey, requireBatch, requireHolding, requirePending } from '../ledger';
import { getPrivate, holdKey, putPrivate, qtyKey, readTransientQuantity } from '../pdc';
import type { TransferInput, TransferResponseInput } from '../schemas';
import { assertTradable } from '../status';
import type { EventDraft, HandlerContext, PendingTransfer } from '../types';

function assertReceiver(pending: PendingTransfer, tenantId: string): void {
  if (pending.toTenantId !== tenantId) {
    throw new ContractError(ErrorCode.NotReceiver, 'caller is not the designated receiver');
  }
}

function assertSender(pending: PendingTransfer, tenantId: string): void {
  if (pending.fromTenantId !== tenantId) {
    throw new ContractError(ErrorCode.NotSender, 'caller is not the sender of this transfer');
  }
}

/** Many pendings per batch may coexist; each is keyed by its transfer event id. */
export async function transferBatch(hc: HandlerContext, input: TransferInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  await requireHolding(hc.ctx, batch.batchId, hc.caller.tenantId);
  assertTradable(batch, hc.now);
  if (input.toTenantId === hc.caller.tenantId) {
    throw new ContractError(ErrorCode.InvalidInput, 'cannot transfer to yourself');
  }
  if (await getPending(hc.ctx, batch.batchId, input.eventId)) {
    throw new ContractError(ErrorCode.AlreadyExists, `transfer ${input.eventId} already exists`);
  }
  const quantity = readTransientQuantity(hc.ctx, input.quantityCommitment);
  if (quantity) await putPrivate(hc.ctx, hc.caller.tenantId, qtyKey(batch.batchId, input.eventId), quantity);
  const pending: PendingTransfer = {
    fromTenantId: hc.caller.tenantId,
    toTenantId: input.toTenantId,
    quantityCommitment: input.quantityCommitment,
  };
  return {
    eventType: EventType.TransferInitiated,
    batch,
    writes: [{ key: pendingKey(batch.batchId, input.eventId), value: pending }],
    fields: {
      fromOrgHash: orgHash(hc.caller.tenantId),
      toOrgHash: orgHash(input.toTenantId),
      quantityCommitment: input.quantityCommitment,
    },
  };
}

/** Accumulates the receiver's plaintext quantity (PDC only) across multiple accepted transfers. */
async function addToHold(hc: HandlerContext, batchId: string, commitment: string): Promise<void> {
  const quantity = readTransientQuantity(hc.ctx, commitment);
  if (!quantity) return;
  const existing = await getPrivate<{ quantity: number }>(hc.ctx, hc.caller.tenantId, holdKey(batchId));
  const total = (existing?.quantity ?? 0) + quantity.quantity;
  await putPrivate(hc.ctx, hc.caller.tenantId, holdKey(batchId), { quantity: total, salt: quantity.salt });
}

/** Accept keeps the sender's holding: it proves who legitimately held; quantities live off-chain / in PDC. */
export async function acceptBatch(hc: HandlerContext, input: TransferResponseInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  const pending = await requirePending(hc.ctx, batch.batchId, input.transferEventId);
  assertReceiver(pending, hc.caller.tenantId);
  assertTradable(batch, hc.now);
  await addToHold(hc, batch.batchId, pending.quantityCommitment);
  const writes = [];
  if (!(await getHolding(hc.ctx, batch.batchId, hc.caller.tenantId))) {
    const holding = {
      tenantId: hc.caller.tenantId,
      orgId: hc.caller.orgId,
      quantityCommitment: pending.quantityCommitment,
      sinceSeq: batch.eventSeq + 1,
    };
    writes.push({ key: holdingKey(batch.batchId, hc.caller.tenantId), value: holding });
  }
  return {
    eventType: EventType.TransferAccepted,
    batch,
    writes,
    deletes: [pendingKey(batch.batchId, input.transferEventId)],
    fields: {
      fromOrgHash: orgHash(pending.fromTenantId),
      toOrgHash: orgHash(hc.caller.tenantId),
      quantityCommitment: pending.quantityCommitment,
      attrs: { transferEventId: input.transferEventId },
    },
  };
}

export async function rejectBatch(hc: HandlerContext, input: TransferResponseInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  const pending = await requirePending(hc.ctx, batch.batchId, input.transferEventId);
  assertReceiver(pending, hc.caller.tenantId);
  return {
    eventType: EventType.TransferRejected,
    batch,
    deletes: [pendingKey(batch.batchId, input.transferEventId)],
    fields: {
      fromOrgHash: orgHash(pending.fromTenantId),
      toOrgHash: orgHash(hc.caller.tenantId),
      attrs: { transferEventId: input.transferEventId },
    },
  };
}

export async function cancelTransfer(hc: HandlerContext, input: TransferResponseInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  const pending = await requirePending(hc.ctx, batch.batchId, input.transferEventId);
  assertSender(pending, hc.caller.tenantId);
  return {
    eventType: EventType.TransferCancelled,
    batch,
    deletes: [pendingKey(batch.batchId, input.transferEventId)],
    fields: {
      fromOrgHash: orgHash(hc.caller.tenantId),
      toOrgHash: orgHash(pending.toTenantId),
      attrs: { transferEventId: input.transferEventId },
    },
  };
}

export { assertSender };
