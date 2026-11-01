import { assertTenant } from '../auth';
import { BatchStatus, ErrorCode, EventType } from '../constants';
import { ContractError } from '../errors';
import { getBatch, getProduct, holdingKey, requireProduct } from '../ledger';
import type { RegisterBatchInput, RegisterProductInput } from '../schemas';
import type { BatchState, EventDraft, HandlerContext, HoldingState } from '../types';

const FIRST_SEQ = 1;

export async function registerProduct(hc: HandlerContext, input: RegisterProductInput): Promise<EventDraft> {
  assertTenant(hc.caller, input.ownerTenantId);
  if (await getProduct(hc.ctx, input.productId)) {
    throw new ContractError(ErrorCode.AlreadyExists, `product ${input.productId} already exists`);
  }
  const product = { productId: input.productId, ownerTenantId: input.ownerTenantId, createdAtMs: hc.now };
  return { eventType: EventType.ProductRegistered, product };
}

export async function registerBatch(hc: HandlerContext, input: RegisterBatchInput): Promise<EventDraft> {
  const product = await requireProduct(hc.ctx, input.productId);
  if (product.ownerTenantId !== hc.caller.tenantId) {
    throw new ContractError(ErrorCode.NotOwner, `product ${input.productId} is owned by another tenant`);
  }
  if (await getBatch(hc.ctx, input.batchId)) {
    throw new ContractError(ErrorCode.AlreadyExists, `batch ${input.batchId} already exists`);
  }
  if (input.expiryDateMs <= input.mfgDateMs) {
    throw new ContractError(ErrorCode.InvalidExpiry, 'expiry must be after manufacture date');
  }
  const batch: BatchState = {
    batchId: input.batchId,
    productId: input.productId,
    originTenantId: hc.caller.tenantId,
    status: BatchStatus.Active,
    quantityCommitment: input.quantityCommitment,
    mfgDateMs: input.mfgDateMs,
    expiryDateMs: input.expiryDateMs,
    eventSeq: 0,
  };
  const holding: HoldingState = {
    tenantId: hc.caller.tenantId,
    orgId: hc.caller.orgId,
    quantityCommitment: input.quantityCommitment,
    sinceSeq: FIRST_SEQ,
  };
  return {
    eventType: EventType.BatchRegistered,
    batch,
    writes: [{ key: holdingKey(batch.batchId, holding.tenantId), value: holding }],
    fields: { quantityCommitment: input.quantityCommitment },
  };
}
