import { computeRecordHash } from '../supply/events';
import { sha256Hex } from '../lib/crypto';
import { canonicalJson } from '../audit/audit';

/** Everything needed to turn one DB event into a chaincode call. */
export interface EventContext {
  event: {
    id: string; batch_id: string; sequence: number; event_type: string; actor_org: string; counterparty_org: string | null;
    quantity: number | null; transfer_id: string | null; corrects_event_id: string | null; payload: Record<string, unknown>;
    record_hash: string; occurred_at: Date;
  };
  batch: { id: string; product_id: string; manufacturer_org_id: string; manufacturing_date: string; expiry_date: string };
  /** Event id of the transfer_created event this event belongs to (transfer lifecycle events only). */
  transferEventId: string | null;
}

export interface ChainCall {
  orgId: string;
  fn: string;
  input: Record<string, unknown>;
  transient?: Record<string, string>;
}

const dateToMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);

export const productEventId = (productId: string): string => `P-${productId}`;

/** Recomputes the canonical hash from the stored row; a mismatch means the DB row changed after commit intent. */
export function recomputeHash(e: EventContext['event']): string {
  return computeRecordHash({
    id: e.id, batchId: e.batch_id, sequence: e.sequence, type: e.event_type, actorOrg: e.actor_org,
    counterpartyOrg: e.counterparty_org, quantity: e.quantity, transferId: e.transfer_id,
    correctsEventId: e.corrects_event_id, payload: e.payload, occurredAt: e.occurred_at.toISOString(),
  });
}

function base(c: EventContext, signatureRef: string) {
  return {
    eventId: c.event.id,
    recordHash: c.event.record_hash,
    dbRecordRef: `evt:${c.event.id}`,
    signatureRef,
    batchId: c.event.batch_id,
  };
}

function transient(c: EventContext, enabled: boolean): Record<string, string> | undefined {
  const salt = c.event.payload.salt;
  if (!enabled || c.event.quantity == null || typeof salt !== 'string') return undefined;
  return { quantity: String(c.event.quantity), salt };
}

/** Maps an event to its chaincode call. Throws for event types that have no ledger function. */
export function buildChainCall(c: EventContext, signatureRef: string, usePdc: boolean): ChainCall {
  const b = base(c, signatureRef);
  const commitment = c.event.payload.quantityCommitment as string;
  const tx = transient(c, usePdc);
  const withTransient = (call: ChainCall): ChainCall => (tx ? { ...call, transient: tx } : call);
  switch (c.event.event_type) {
    case 'batch_registered':
      return withTransient({
        orgId: c.event.actor_org, fn: 'RegisterBatch',
        input: { ...b, productId: c.batch.product_id, quantityCommitment: commitment, mfgDateMs: dateToMs(c.batch.manufacturing_date), expiryDateMs: dateToMs(c.batch.expiry_date) },
      });
    case 'transfer_created':
      return withTransient({
        orgId: c.event.actor_org, fn: 'TransferBatch',
        input: { ...b, toTenantId: c.event.counterparty_org, quantityCommitment: commitment },
      });
    case 'transfer_dispatched':
    case 'transfer_in_transit':
      return { orgId: c.event.actor_org, fn: 'RecordShipment', input: { ...b, transferEventId: c.transferEventId } };
    case 'transfer_received':
      return withTransient({ orgId: c.event.actor_org, fn: 'AcceptBatch', input: { ...b, transferEventId: c.transferEventId } });
    case 'transfer_rejected':
      return { orgId: c.event.actor_org, fn: 'RejectBatch', input: { ...b, transferEventId: c.transferEventId } };
    case 'transfer_cancelled':
      return { orgId: c.event.actor_org, fn: 'CancelTransfer', input: { ...b, transferEventId: c.transferEventId } };
    case 'retail_sale':
      return withTransient({ orgId: c.event.actor_org, fn: 'RecordRetailSale', input: { ...b, saleCommitment: commitment } });
    default:
      throw new Error(`event type ${c.event.event_type} has no chaincode function`);
  }
}

/** Idempotent product registration that must precede a batch's RegisterBatch. */
export function buildProductCall(productId: string, ownerOrgId: string, productRecord: unknown, signatureRef: string): ChainCall {
  return {
    orgId: ownerOrgId,
    fn: 'RegisterProduct',
    input: {
      eventId: productEventId(productId),
      recordHash: sha256Hex(canonicalJson(productRecord)),
      dbRecordRef: `product:${productId}`,
      signatureRef,
      productId,
      ownerTenantId: ownerOrgId,
    },
  };
}
