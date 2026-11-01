import type { Logger } from 'pino';
import type { Db, Tx } from '../db/db';
import { enqueue } from '../jobs/queue';
import { buildChainCall, buildProductCall, productEventId, recomputeHash, type EventContext } from './args';
import { ChainError, type LedgerGateway } from './gateway';
import { signatureRef, type AppSigner } from './signer';

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const MAX_ATTEMPTS = 8;
const IN_FLIGHT_VISIBILITY_SECONDS = 60;
const DEFAULT_BATCH_SIZE = 10;

export interface OutboxDeps {
  db: Db;
  gateway: LedgerGateway;
  signer: AppSigner;
  logger: Logger;
  usePrivateData: boolean;
}

interface Claimed {
  id: string;
  event_id: string;
  attempts: number;
}

export interface OutboxStats {
  committed: number;
  retried: number;
  failed: number;
}

/**
 * Claims rows whose batch has no earlier uncommitted event, so ledger order always matches the
 * database sequence. The in-flight visibility window lets another worker retry after a crash;
 * chaincode idempotency (eventId) makes that safe.
 */
async function claim(db: Db, limit: number): Promise<Claimed[]> {
  return db.withSystem(async (tx) => {
    const res = await tx.query<Claimed>(
      `UPDATE blockchain_transactions SET status = 'submitted', attempts = attempts + 1, submitted_at = now(),
         next_attempt_at = now() + make_interval(secs => $2)
       WHERE id IN (
         SELECT t.id FROM blockchain_transactions t JOIN supply_chain_events e ON e.id = t.event_id
         WHERE t.status IN ('pending', 'submitted') AND t.next_attempt_at <= now()
           AND NOT EXISTS (
             SELECT 1 FROM blockchain_transactions t2 JOIN supply_chain_events e2 ON e2.id = t2.event_id
             WHERE e2.batch_id = e.batch_id AND e2.sequence < e.sequence AND t2.status <> 'committed')
         ORDER BY t.created_at LIMIT $1 FOR UPDATE OF t SKIP LOCKED)
       RETURNING id, event_id, attempts`,
      [limit, IN_FLIGHT_VISIBILITY_SECONDS],
    );
    return res.rows;
  });
}

async function loadContext(tx: Tx, eventId: string): Promise<EventContext> {
  const ev = await tx.query<EventContext['event']>('SELECT * FROM supply_chain_events WHERE id = $1', [eventId]);
  const event = ev.rows[0] as EventContext['event'];
  const b = await tx.query<EventContext['batch']>(
    'SELECT id, product_id, manufacturer_org_id, manufacturing_date, expiry_date FROM seed_batches WHERE id = $1', [event.batch_id]);
  let transferEventId: string | null = null;
  if (event.transfer_id) {
    const t = await tx.query<{ id: string }>(
      "SELECT id FROM supply_chain_events WHERE transfer_id = $1 AND event_type = 'transfer_created'", [event.transfer_id]);
    transferEventId = t.rows[0]?.id ?? null;
  }
  return { event, batch: b.rows[0] as EventContext['batch'], transferEventId };
}

async function ensureProduct(deps: OutboxDeps, ctx: EventContext): Promise<void> {
  const prod = await deps.db.withSystem(async (tx) =>
    (await tx.query('SELECT id, tenant_id, name, brand, crop_type, variety, category FROM products WHERE id = $1', [ctx.batch.product_id])).rows[0]);
  const sig = await deps.signer.sign(productEventId(ctx.batch.product_id));
  const call = buildProductCall(ctx.batch.product_id, ctx.batch.manufacturer_org_id, prod, signatureRef(deps.signer.keyId, sig));
  await deps.gateway.submit(call);
}

async function markCommitted(db: Db, row: Claimed, r: { txId: string; blockNumber: number | null; validationCode: string }, sig: { value: string; keyId: string }) {
  await db.withSystem(async (tx) => {
    await tx.query(
      `UPDATE blockchain_transactions SET status = 'committed', fabric_tx_id = $2, block_number = $3, validation_code = $4,
         signature = $5, signer_key_id = $6, committed_at = now(), last_error = NULL WHERE id = $1`,
      [row.id, r.txId, r.blockNumber, r.validationCode, sig.value, sig.keyId]);
    await enqueue(tx, { type: 'notify_event', payload: { eventId: row.event_id }, dedupeKey: `notify:${row.event_id}` });
    await enqueue(tx, { type: 'verify_ledger', payload: { eventId: row.event_id }, dedupeKey: `verify:${row.event_id}`, delayMs: 5_000 });
  });
}

async function markFailure(db: Db, row: Claimed, err: unknown, logger: Logger): Promise<'retried' | 'failed'> {
  const retryable = err instanceof ChainError ? err.retryable : false;
  const final = !retryable || row.attempts >= MAX_ATTEMPTS;
  const backoff = Math.min(BASE_BACKOFF_MS * 2 ** row.attempts, MAX_BACKOFF_MS);
  await db.withSystem((tx) =>
    tx.query(
      `UPDATE blockchain_transactions SET status = $2, last_error = $3, next_attempt_at = now() + make_interval(secs => $4) WHERE id = $1`,
      [row.id, final ? 'failed' : 'pending', String(err instanceof Error ? err.message : err).slice(0, 500), backoff / 1000]));
  logger.warn({ outboxId: row.id, final, err: String(err) }, 'chain submission failed');
  return final ? 'failed' : 'retried';
}

async function processOne(deps: OutboxDeps, row: Claimed): Promise<'committed' | 'retried' | 'failed'> {
  try {
    const ctx = await deps.db.withSystem((tx) => loadContext(tx, row.event_id));
    // Refuse to commit a record whose database row no longer matches the hash taken at write time.
    if (recomputeHash(ctx.event) !== ctx.event.record_hash) throw new ChainError('record hash mismatch: database row altered', false);
    const sig = await deps.signer.sign(ctx.event.record_hash);
    const ref = signatureRef(deps.signer.keyId, sig);
    if (ctx.event.event_type === 'batch_registered') await ensureProduct(deps, ctx);
    const call = buildChainCall(ctx, ref, deps.usePrivateData);
    const result = await deps.gateway.submit(call);
    await markCommitted(deps.db, row, result, { value: sig, keyId: deps.signer.keyId });
    return 'committed';
  } catch (err) {
    return markFailure(deps.db, row, err, deps.logger);
  }
}

/** One polling pass. Rows of different batches run in parallel; per-batch order is enforced by claim(). */
export async function processOutbox(deps: OutboxDeps, limit = DEFAULT_BATCH_SIZE): Promise<OutboxStats> {
  const rows = await claim(deps.db, limit);
  const outcomes = await Promise.all(rows.map((r) => processOne(deps, r)));
  return {
    committed: outcomes.filter((o) => o === 'committed').length,
    retried: outcomes.filter((o) => o === 'retried').length,
    failed: outcomes.filter((o) => o === 'failed').length,
  };
}
