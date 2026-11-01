import type { Tx } from '../db/db';
import { AppError, notFound } from '../errors';
import type { OrgActor } from './actor';

export interface TransferRow {
  id: string;
  tenant_id: string;
  batch_id: string;
  from_org: string;
  to_org: string;
  quantity: number;
  received_quantity: number | null;
  status: 'created' | 'dispatched' | 'in_transit' | 'received' | 'rejected' | 'cancelled';
  under_investigation: boolean;
  idempotency_key: string;
  requested_by: string;
  source_location: string | null;
  destination_location: string | null;
  carrier: string | null;
  vehicle_ref: string | null;
  dispatched_at: Date | null;
  received_at: Date | null;
  note: string | null;
  created_at: Date;
  from_name?: string | null;
  to_name?: string | null;
  batch_code?: string;
}

export const toTransferDto = (t: TransferRow) => ({
  id: t.id, batchId: t.batch_id, batchCode: t.batch_code, fromOrgId: t.from_org, fromOrgName: t.from_name,
  toOrgId: t.to_org, toOrgName: t.to_name, quantity: t.quantity, receivedQuantity: t.received_quantity, status: t.status,
  underInvestigation: t.under_investigation, sourceLocation: t.source_location, destinationLocation: t.destination_location,
  carrier: t.carrier, vehicleRef: t.vehicle_ref, dispatchedAt: t.dispatched_at, receivedAt: t.received_at, note: t.note,
  createdAt: t.created_at,
});

export const invalidState = (status: string, wanted: string): AppError =>
  new AppError(409, 'INVALID_STATE', `Transfer is ${status}; expected ${wanted}`);

export const batchBlocked = (code: 'BATCH_EXPIRED' | 'BATCH_NOT_ACTIVE'): AppError =>
  new AppError(409, code, code === 'BATCH_EXPIRED' ? 'This batch is past its expiry date' : 'This batch is not active');

/** Loads and locks a transfer. Non-parties get 404 so existence is not leaked. */
export async function lockTransfer(tx: Tx, id: string, actor: OrgActor): Promise<TransferRow> {
  const res = await tx.query<TransferRow>('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
  const row = res.rows[0];
  const isParty = row && (row.from_org === actor.orgId || row.to_org === actor.orgId);
  if (!row || !isParty) throw notFound('Transfer not found');
  return row;
}

export interface BatchGate {
  status: string;
  is_expired: boolean;
  tenant_id: string;
}

export async function loadBatchGate(tx: Tx, batchId: string): Promise<BatchGate> {
  const res = await tx.query<BatchGate>(
    'SELECT status, (expiry_date < CURRENT_DATE) AS is_expired, tenant_id FROM seed_batches WHERE id = $1', [batchId]);
  if (!res.rows[0]) throw notFound('Batch not found');
  return res.rows[0];
}

/** Dispatching or selling is blocked for expired, held or recalled batches. */
export function assertMovable(gate: BatchGate): void {
  if (gate.is_expired) throw batchBlocked('BATCH_EXPIRED');
  if (gate.status !== 'active') throw batchBlocked('BATCH_NOT_ACTIVE');
}
