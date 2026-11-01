import type { Tx } from '../db/db';
import { AppError } from '../errors';

export interface Holding {
  id: string;
  tenant_id: string;
  batch_id: string;
  org_id: string;
  quantity: number;
  reserved: number;
}

export type MovementReason = 'initial' | 'transfer_out' | 'transfer_in' | 'sale' | 'correction';

export interface MovementRef {
  refType?: string;
  refId?: string;
  idempotencyKey?: string;
}

export const available = (h: Holding): number => h.quantity - h.reserved;

export const insufficientInventory = (have: number, want: number): AppError =>
  new AppError(409, 'INSUFFICIENT_INVENTORY', `Only ${have} units are available; ${want} requested`, { available: have, requested: want });

export async function findHolding(tx: Tx, batchId: string, orgId: string): Promise<Holding | null> {
  const res = await tx.query<Holding>('SELECT * FROM batch_holdings WHERE batch_id = $1 AND org_id = $2', [batchId, orgId]);
  return res.rows[0] ?? null;
}

/** Creates the holding row if absent; never changes quantity. */
export async function ensureHolding(tx: Tx, tenantId: string, batchId: string, orgId: string): Promise<void> {
  await tx.query(
    'INSERT INTO batch_holdings (tenant_id, batch_id, org_id) VALUES ($1,$2,$3) ON CONFLICT (batch_id, org_id) DO NOTHING',
    [tenantId, batchId, orgId],
  );
}

/**
 * Locks the given holdings in a fixed (id) order so two transfers moving stock in opposite
 * directions cannot deadlock. Returns them keyed by org id.
 */
export async function lockHoldings(tx: Tx, batchId: string, orgIds: string[]): Promise<Map<string, Holding>> {
  const res = await tx.query<Holding>(
    'SELECT * FROM batch_holdings WHERE batch_id = $1 AND org_id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
    [batchId, orgIds],
  );
  return new Map(res.rows.map((h) => [h.org_id, h]));
}

/** Applies a quantity change to a locked holding and appends the ledger row. */
export async function applyMovement(tx: Tx, h: Holding, delta: number, reason: MovementReason, ref: MovementRef = {}): Promise<number> {
  const upd = await tx.query<{ quantity: number }>(
    'UPDATE batch_holdings SET quantity = quantity + $2, updated_at = now() WHERE id = $1 RETURNING quantity',
    [h.id, delta],
  );
  const balance = upd.rows[0]?.quantity as number;
  await tx.query(
    `INSERT INTO inventory_movements (tenant_id, holding_id, batch_id, org_id, delta, balance_after, reason, ref_type, ref_id, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [h.tenant_id, h.id, h.batch_id, h.org_id, delta, balance, reason, ref.refType ?? null, ref.refId ?? null, ref.idempotencyKey ?? null],
  );
  return balance;
}

export async function adjustReserved(tx: Tx, holdingId: string, delta: number): Promise<void> {
  await tx.query('UPDATE batch_holdings SET reserved = reserved + $2, updated_at = now() WHERE id = $1', [holdingId, delta]);
}
