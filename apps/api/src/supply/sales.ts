import type { RecordSaleInput } from '@smartseed/shared';
import type { Db, Tx } from '../db/db';
import { AppError, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import type { Actor, OrgActor } from './actor';
import { recordBlockedAttempt } from './attempts';
import { appendEvent } from './events';
import { applyMovement, available, findHolding, insufficientInventory, lockHoldings } from './inventory';
import { assertMovable, loadBatchGate } from './transferTypes';

const UNIQUE_VIOLATION = '23505';

async function saleTx(tx: Tx, actor: OrgActor, input: RecordSaleInput, key: string) {
  const replay = await tx.query<{ delta: number; balance_after: number }>(
    'SELECT delta, balance_after FROM inventory_movements WHERE org_id = $1 AND idempotency_key = $2', [actor.orgId, key]);
  if (replay.rows[0]) return { sold: -replay.rows[0].delta, remaining: replay.rows[0].balance_after, replayed: true };

  const holding = await findHolding(tx, input.batchId, actor.orgId);
  if (!holding) throw notFound('Batch not found');
  assertMovable(await loadBatchGate(tx, input.batchId));
  const locked = (await lockHoldings(tx, input.batchId, [actor.orgId])).get(actor.orgId)!;
  if (available(locked) < input.quantity) throw insufficientInventory(available(locked), input.quantity);
  const remaining = await applyMovement(tx, locked, -input.quantity, 'sale', { idempotencyKey: key });
  await appendEvent(tx, { tenantId: holding.tenant_id, batchId: input.batchId, type: 'retail_sale', actorOrg: actor.orgId, quantity: input.quantity });
  await writeAudit(tx, {
    tenantId: holding.tenant_id, actorId: actor.userId, action: 'sale.recorded', entityType: 'batch', entityId: input.batchId,
    ip: actor.ip, metadata: { quantity: input.quantity },
  });
  return { sold: input.quantity, remaining, replayed: false };
}

export function createSaleService(db: Db) {
  async function record(actor: OrgActor, input: RecordSaleInput, key: string) {
    try {
      return await db.withSystem((tx) => saleTx(tx, actor, input, key));
    } catch (err) {
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new AppError(409, 'DUPLICATE_REQUEST', 'This sale is already being processed');
      await recordBlockedAttempt(db, { orgId: actor.orgId, userId: actor.userId, batchId: input.batchId, kind: 'sale' }, err);
      throw err;
    }
  }

  /** Own holdings for the caller's organization. */
  async function inventory(actor: Actor) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query(
        `SELECT h.batch_id AS "batchId", b.batch_code AS "batchCode", p.name AS "productName", p.brand,
                b.expiry_date AS "expiryDate", (b.expiry_date < CURRENT_DATE) AS expired, b.status AS "batchStatus",
                h.quantity, h.reserved, (h.quantity - h.reserved) AS available
         FROM batch_holdings h JOIN seed_batches b ON b.id = h.batch_id JOIN products p ON p.id = b.product_id
         WHERE h.org_id = $1 ORDER BY b.expiry_date, b.batch_code`, [actor.orgId]);
      return res.rows;
    });
  }

  async function movements(actor: Actor, batchId: string) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query(
        `SELECT id, delta, balance_after AS "balanceAfter", reason, ref_type AS "refType", ref_id AS "refId", created_at AS "createdAt"
         FROM inventory_movements WHERE batch_id = $1 AND org_id = $2 ORDER BY created_at, id`, [batchId, actor.orgId]);
      return res.rows;
    });
  }

  return { record, inventory, movements };
}

export type SaleService = ReturnType<typeof createSaleService>;
