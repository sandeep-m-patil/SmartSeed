import { isPrivileged } from '../auth';
import { BatchStatus, ErrorCode, EventType, Outcome, Role } from '../constants';
import { ContractError } from '../errors';
import { listHoldings, requireBatch, requireEvent } from '../ledger';
import type { OutcomeInput, StatusUpdateInput } from '../schemas';
import { assertTransition, canTransition } from '../status';
import type { BatchState, EventDraft, HandlerContext } from '../types';

/** Which roles may move a batch INTO each status. Owners may only close out their own stock. */
const OWNER_TARGETS: readonly BatchStatus[] = [BatchStatus.SoldOut];

/** A holder may close out the batch only when it is the sole holder (otherwise it would sell out others' stock). */
async function assertSoleHolder(hc: HandlerContext, batch: BatchState): Promise<void> {
  const holders = await listHoldings(hc.ctx, batch.batchId);
  if (holders.length !== 1 || holders[0]?.tenantId !== hc.caller.tenantId) {
    throw new ContractError(ErrorCode.NotHolder, 'only the sole holder may mark a batch SOLD_OUT');
  }
}

async function assertMayTarget(hc: HandlerContext, batch: BatchState, target: BatchStatus): Promise<void> {
  if (isPrivileged(hc.caller)) return;
  if (hc.caller.role === Role.Gateway || hc.caller.role === Role.Carrier || !OWNER_TARGETS.includes(target)) {
    throw new ContractError(ErrorCode.UnauthorizedRole, `role '${hc.caller.role}' may not set status ${target}`);
  }
  await assertSoleHolder(hc, batch);
}

export async function updateBatchStatus(hc: HandlerContext, input: StatusUpdateInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  await assertMayTarget(hc, batch, input.newStatus);
  assertTransition(batch.status, input.newStatus);
  const previousStatus = batch.status;
  batch.status = input.newStatus;
  return {
    eventType: EventType.StatusUpdated,
    batch,
    fields: { attrs: { fromStatus: previousStatus, toStatus: input.newStatus } },
  };
}

function statusForOutcome(batch: BatchState, outcome: Outcome): BatchStatus | undefined {
  if (outcome === Outcome.Confirmed && canTransition(batch.status, BatchStatus.Revoked)) return BatchStatus.Revoked;
  if (outcome === Outcome.Cleared && batch.status === BatchStatus.Held) return BatchStatus.Active;
  return undefined;
}

export async function recordInvestigationOutcome(hc: HandlerContext, input: OutcomeInput): Promise<EventDraft> {
  const batch = await requireBatch(hc.ctx, input.batchId);
  const report = await requireEvent(hc.ctx, input.reportEventId);
  if (report.eventType !== EventType.CounterfeitReport || report.batchId !== batch.batchId) {
    throw new ContractError(ErrorCode.InvalidInput, 'reportEventId is not a counterfeit report for this batch');
  }
  const next = statusForOutcome(batch, input.outcome);
  if (next) batch.status = next;
  return {
    eventType: EventType.InvestigationOutcome,
    batch,
    fields: { attrs: { reportEventId: input.reportEventId, outcome: input.outcome, resultStatus: batch.status } },
  };
}
