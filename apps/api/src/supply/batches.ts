import { randomBytes } from 'node:crypto';
import type { CreateBatchInput } from '@smartseed/shared';
import type { Db } from '../db/db';
import { AppError, notFound } from '../errors';
import { writeAudit, canonicalJson } from '../audit/audit';
import { sha256Hex } from '../lib/crypto';
import { decodeCursor, toPage } from '../lib/pagination';
import type { Actor, TenantActor } from './actor';
import { appendEvent } from './events';
import { applyMovement, ensureHolding, lockHoldings } from './inventory';
import { insertCertifications } from './products';
import { assertWithinLimit } from '../billing/service';

const UNIQUE_VIOLATION = '23505';
const MAX_CODE_ATTEMPTS = 5;
const CODE_RANDOM_BYTES = 4;

interface BatchRow {
  id: string; tenant_id: string; product_id: string; batch_code: string; manufacturing_date: string; expiry_date: string;
  production_location: string; facility: string; initial_quantity: number; unit: string; status: string;
  record_hash: string; created_at: Date; product_name?: string; brand?: string; is_expired?: boolean;
}

const toDto = (b: BatchRow) => ({
  id: b.id, productId: b.product_id, productName: b.product_name, brand: b.brand, batchCode: b.batch_code,
  manufacturingDate: b.manufacturing_date, expiryDate: b.expiry_date, productionLocation: b.production_location,
  facility: b.facility, initialQuantity: b.initial_quantity, unit: b.unit, status: b.status, expired: b.is_expired ?? false,
  recordHash: b.record_hash, createdAt: b.created_at,
});

const newBatchCode = (year: string): string => `SS${year}-${randomBytes(CODE_RANDOM_BYTES).toString('hex').toUpperCase()}`;

const SELECT_BATCH = `SELECT b.*, p.name AS product_name, p.brand, (b.expiry_date < CURRENT_DATE) AS is_expired
                      FROM seed_batches b JOIN products p ON p.id = b.product_id`;

export function createBatchService(db: Db) {
  async function insertBatch(tx: import('../db/db').Tx, actor: TenantActor, input: CreateBatchInput) {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = newBatchCode(input.manufacturingDate.slice(0, 4));
      const hash = sha256Hex(canonicalJson({ code, ...input, tenantId: actor.tenantId }));
      try {
        await tx.query('SAVEPOINT batch_insert');
        const res = await tx.query<BatchRow>(
          `INSERT INTO seed_batches (tenant_id, product_id, manufacturer_org_id, batch_code, manufacturing_date, expiry_date,
             production_location, facility, initial_quantity, unit, record_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [actor.tenantId, input.productId, actor.orgId, code, input.manufacturingDate, input.expiryDate,
            input.productionLocation, input.facility, input.initialQuantity, input.unit, hash]);
        return res.rows[0] as BatchRow;
      } catch (err) {
        await tx.query('ROLLBACK TO SAVEPOINT batch_insert');
        if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;
      }
    }
    throw new AppError(500, 'BATCH_CODE_EXHAUSTED', 'Could not allocate a unique batch code');
  }

  /**
   * Runs as a system transaction because it writes holdings/events, but every statement is
   * pinned to the caller's tenant: the product must belong to it.
   */
  async function create(actor: TenantActor, input: CreateBatchInput) {
    return db.withSystem(async (tx) => {
      const product = await tx.query('SELECT 1 FROM products WHERE id = $1 AND tenant_id = $2', [input.productId, actor.tenantId]);
      if (!product.rowCount) throw notFound('Product not found');
      await assertWithinLimit(tx, actor.tenantId, 'batches');
      const batch = await insertBatch(tx, actor, input);
      await insertCertifications(tx, actor.tenantId, { batchId: batch.id }, input.certifications);
      await ensureHolding(tx, actor.tenantId, batch.id, actor.orgId);
      const holding = (await lockHoldings(tx, batch.id, [actor.orgId])).get(actor.orgId)!;
      await applyMovement(tx, holding, input.initialQuantity, 'initial', { refType: 'batch', refId: batch.id });
      await appendEvent(tx, {
        tenantId: actor.tenantId, batchId: batch.id, type: 'batch_registered', actorOrg: actor.orgId,
        quantity: input.initialQuantity, payload: { batchCode: batch.batch_code, recordHash: batch.record_hash },
      });
      await writeAudit(tx, {
        tenantId: actor.tenantId, actorId: actor.userId, action: 'batch.created', entityType: 'batch', entityId: batch.id, ip: actor.ip,
        metadata: { batchCode: batch.batch_code, quantity: input.initialQuantity },
      });
      return toDto(batch);
    });
  }

  async function list(actor: Actor, q: { limit: number; cursor?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withActor(actor, async (tx) =>
      (await tx.query<BatchRow>(
        `${SELECT_BATCH} WHERE ($1::timestamptz IS NULL OR (b.created_at, b.id) < ($1, $2::uuid))
         ORDER BY b.created_at DESC, b.id DESC LIMIT $3`,
        [cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  async function get(actor: Actor, id: string) {
    return db.withActor(actor, async (tx) => {
      const res = await tx.query<BatchRow>(`${SELECT_BATCH} WHERE b.id = $1`, [id]);
      if (!res.rows[0]) throw notFound('Batch not found');
      const certs = await tx.query('SELECT type, issuer, number, valid_from AS "validFrom", valid_to AS "validTo" FROM certifications WHERE batch_id = $1', [id]);
      const holdings = await tx.query(
        'SELECT org_id AS "orgId", quantity, reserved FROM batch_holdings WHERE batch_id = $1 ORDER BY quantity DESC', [id]);
      return { ...toDto(res.rows[0]), certifications: certs.rows, holdings: holdings.rows };
    });
  }

  async function timeline(actor: Actor, batchId: string) {
    return db.withActor(actor, async (tx) => {
      const visible = await tx.query('SELECT 1 FROM seed_batches WHERE id = $1', [batchId]);
      if (!visible.rowCount) throw notFound('Batch not found');
      const res = await tx.query(
        `SELECT e.id, e.sequence, e.event_type AS "eventType", e.actor_org AS "actorOrg", e.counterparty_org AS "counterpartyOrg",
                e.quantity, e.transfer_id AS "transferId", e.occurred_at AS "occurredAt", e.record_hash AS "recordHash",
                t.status AS "chainStatus", t.fabric_tx_id AS "chainTxId"
         FROM supply_chain_events e LEFT JOIN blockchain_transactions t ON t.event_id = e.id
         WHERE e.batch_id = $1 ORDER BY e.sequence`, [batchId]);
      return res.rows;
    });
  }

  return { create, list, get, timeline };
}

export type BatchService = ReturnType<typeof createBatchService>;
