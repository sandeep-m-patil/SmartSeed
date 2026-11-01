import { orgHash } from '../auth';
import { ErrorCode, EventType, Role } from '../constants';
import { ContractError } from '../errors';
import { requireBatch, requireHolding, requirePending } from '../ledger';
import { getPrivate, holdKey, putPrivate, readTransientQuantity, soldKey } from '../pdc';
import type {
  CounterfeitReportInput,
  FarmerVerificationInput,
  RetailSaleInput,
  ShipmentInput,
} from '../schemas';
import { assertTradable } from '../status';
import type { EventDraft, HandlerContext } from '../types';
import { assertSender } from './transfer';

export async function recordShipment(hc: HandlerContext, input: ShipmentInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  const pending = await requirePending(hc.ctx, batch.batchId, input.transferEventId);
  if (hc.caller.role !== Role.Carrier) assertSender(pending, hc.caller.tenantId);
  return {
    eventType: EventType.ShipmentRecorded,
    batch,
    fields: { attrs: { transferEventId: input.transferEventId } },
  };
}

async function checkAggregateSold(hc: HandlerContext, batchId: string, quantity: number): Promise<void> {
  const tenant = hc.caller.tenantId;
  const held = await getPrivate<{ quantity: number }>(hc.ctx, tenant, holdKey(batchId));
  const sold = (await getPrivate<number>(hc.ctx, tenant, soldKey(batchId))) ?? 0;
  if (held && sold + quantity > held.quantity) {
    throw new ContractError(ErrorCode.QuantityExceeded, 'aggregate sold quantity exceeds received quantity');
  }
  await putPrivate(hc.ctx, tenant, soldKey(batchId), sold + quantity);
}

export async function recordRetailSale(hc: HandlerContext, input: RetailSaleInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  await requireHolding(hc.ctx, batch.batchId, hc.caller.tenantId);
  assertTradable(batch, hc.now);
  const quantity = readTransientQuantity(hc.ctx, input.saleCommitment);
  if (quantity) await checkAggregateSold(hc, batch.batchId, quantity.quantity);
  return {
    eventType: EventType.RetailSale,
    batch,
    fields: { quantityCommitment: input.saleCommitment, fromOrgHash: orgHash(hc.caller.tenantId) },
  };
}

export async function recordFarmerVerification(
  hc: HandlerContext,
  input: FarmerVerificationInput,
): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  return {
    eventType: EventType.FarmerVerification,
    batch,
    fields: { attrs: { farmerHash: input.farmerHash, regionCode: input.regionCode } },
  };
}

export async function recordCounterfeitReport(
  hc: HandlerContext,
  input: CounterfeitReportInput,
): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  return { eventType: EventType.CounterfeitReport, batch, fields: { attrs: { reason: input.reason } } };
}
