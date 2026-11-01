import { randomBytes, randomUUID } from 'node:crypto';
import type { Tx } from '../db/db';
import { canonicalJson } from '../audit/audit';
import { sha256Hex } from '../lib/crypto';

export const EVENT_TYPES = [
  'batch_registered',
  'transfer_created',
  'transfer_dispatched',
  'transfer_in_transit',
  'transfer_received',
  'transfer_rejected',
  'transfer_cancelled',
  'discrepancy_recorded',
  'retail_sale',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Chaincode function each event is committed through. `null` = off-chain only (a receipt variance
 * is derived from two on-chain commitments and has no ledger function of its own).
 */
export const CHAIN_FUNCTION: Record<EventType, string | null> = {
  batch_registered: 'RegisterBatch',
  transfer_created: 'TransferBatch',
  transfer_dispatched: 'RecordShipment',
  transfer_in_transit: 'RecordShipment',
  transfer_received: 'AcceptBatch',
  transfer_rejected: 'RejectBatch',
  transfer_cancelled: 'CancelTransfer',
  discrepancy_recorded: null,
  retail_sale: 'RecordRetailSale',
};

const SALT_BYTES = 16;

export interface NewEvent {
  tenantId: string;
  batchId: string;
  type: EventType;
  actorOrg: string;
  counterpartyOrg?: string | null;
  quantity?: number | null;
  transferId?: string | null;
  correctsEventId?: string | null;
  payload?: Record<string, unknown>;
}

export interface StoredEvent {
  id: string;
  sequence: number;
  recordHash: string;
}

/** The exact record whose canonical hash is committed on-chain; also used to re-verify later. */
export interface HashableEvent {
  id: string;
  batchId: string;
  sequence: number;
  type: string;
  actorOrg: string;
  counterpartyOrg: string | null;
  quantity: number | null;
  transferId: string | null;
  correctsEventId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export const computeRecordHash = (e: HashableEvent): string => sha256Hex(canonicalJson(e));

export const quantityCommitment = (quantity: number, salt: string): string => sha256Hex(`${quantity}|${salt}`);

/**
 * Appends an immutable event and (when it has a chain function) its blockchain outbox row in the
 * caller's transaction, so chain intent commits atomically with the state change. Quantities are
 * committed as H(quantity | salt); the salt stays in the off-chain payload.
 */
export async function appendEvent(tx: Tx, e: NewEvent): Promise<StoredEvent> {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`batch:${e.batchId}`]);
  const seqRes = await tx.query<{ next: number }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM supply_chain_events WHERE batch_id = $1',
    [e.batchId],
  );
  const sequence = seqRes.rows[0]?.next as number;
  const id = randomUUID();
  const occurredAt = new Date();
  const payload: Record<string, unknown> = { ...(e.payload ?? {}) };
  if (e.quantity != null) {
    const salt = randomBytes(SALT_BYTES).toString('hex');
    payload.salt = salt;
    payload.quantityCommitment = quantityCommitment(e.quantity, salt);
  }
  const recordHash = computeRecordHash({
    id, batchId: e.batchId, sequence, type: e.type, actorOrg: e.actorOrg, counterpartyOrg: e.counterpartyOrg ?? null,
    quantity: e.quantity ?? null, transferId: e.transferId ?? null, correctsEventId: e.correctsEventId ?? null,
    payload, occurredAt: occurredAt.toISOString(),
  });
  await tx.query(
    `INSERT INTO supply_chain_events
       (id, tenant_id, batch_id, sequence, event_type, actor_org, counterparty_org, quantity, transfer_id, corrects_event_id, payload, record_hash, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, e.tenantId, e.batchId, sequence, e.type, e.actorOrg, e.counterpartyOrg ?? null, e.quantity ?? null,
      e.transferId ?? null, e.correctsEventId ?? null, JSON.stringify(payload), recordHash, occurredAt],
  );
  const chainFn = CHAIN_FUNCTION[e.type];
  if (chainFn) {
    await tx.query(
      'INSERT INTO blockchain_transactions (tenant_id, event_id, chain_event_id, function_name) VALUES ($1,$2,$3,$4)',
      [e.tenantId, id, id, chainFn],
    );
  }
  return { id, sequence, recordHash };
}
