import type { Tx } from '../db/db';
import { sequential } from '../lib/sequential';

const SCAN_LIMIT = 500;
const TRANSFER_LIMIT = 200;
const EVENT_LIMIT = 300;
const ATTEMPT_LIMIT = 100;
const HISTORY_DAYS = 90;

export interface ScoreRequest {
  subject: { type: 'batch'; id: string; batchId: string; tenantId: string };
  now: string;
  context: Record<string, unknown>;
}

async function chainVerified(tx: Tx, batchId: string, ledger: string): Promise<boolean | null> {
  const res = await tx.query<{ total: string; committed: string; failed: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE t.status = 'committed') AS committed,
            count(*) FILTER (WHERE t.status = 'failed') AS failed
     FROM blockchain_transactions t JOIN supply_chain_events e ON e.id = t.event_id WHERE e.batch_id = $1`, [batchId]);
  const { total, committed, failed } = res.rows[0] as { total: string; committed: string; failed: string };
  if (ledger === 'mismatch' || Number(failed) > 0) return false;
  return Number(total) > 0 && total === committed ? true : null; // null = not yet confirmed (unknown), never "true"
}

async function actorHistory(tx: Tx, batchId: string, orgIds: string[]) {
  if (orgIds.length === 0) return {};
  const res = await tx.query<{ org_id: string; prior_alerts: string; prior_risk_avg: string | null }>(
    `SELECT o.org_id,
            (SELECT count(DISTINCT a.id) FROM alerts a JOIN supply_chain_events e ON e.batch_id = a.batch_id
              WHERE e.actor_org = o.org_id AND a.batch_id <> $1 AND a.detected_at > now() - make_interval(days => $3)) AS prior_alerts,
            (SELECT avg(r.score) FROM risk_scores r WHERE r.batch_id IN (
               SELECT DISTINCT e.batch_id FROM supply_chain_events e WHERE e.actor_org = o.org_id AND e.batch_id <> $1)) AS prior_risk_avg
     FROM unnest($2::uuid[]) AS o(org_id)`, [batchId, orgIds, HISTORY_DAYS]);
  return Object.fromEntries(res.rows.map((r) => [r.org_id, { priorAlerts: Number(r.prior_alerts), priorRiskAvg: Number(r.prior_risk_avg ?? 0) }]));
}

/** Gathers the records the detection service scores. Read-only; runs in the worker's system context. */
export async function buildScoreRequest(tx: Tx, batchId: string): Promise<ScoreRequest | null> {
  const b = await tx.query<{ tenant_id: string; initial_quantity: number; expiry_date: string; status: string; ledger_status: string }>(
    'SELECT tenant_id, initial_quantity, expiry_date, status, ledger_status FROM seed_batches WHERE id = $1', [batchId]);
  const batch = b.rows[0];
  if (!batch) return null;
  const [qr, sold, moved, holdings, scans, transfers, events, attempts] = await sequential([
    () => tx.query<{ status: string }>("SELECT status FROM qr_codes WHERE batch_id = $1 AND kind = 'batch' ORDER BY issued_at DESC LIMIT 1", [batchId]),
    () => tx.query<{ n: string }>("SELECT COALESCE(-SUM(delta), 0) AS n FROM inventory_movements WHERE batch_id = $1 AND reason = 'sale'", [batchId]),
    () => tx.query<{ n: string }>(
      `SELECT COALESCE(SUM(t.quantity), 0) AS n FROM transfers t JOIN seed_batches s ON s.id = t.batch_id
       WHERE t.batch_id = $1 AND t.from_org = s.manufacturer_org_id AND t.status NOT IN ('rejected', 'cancelled')`, [batchId]),
    () => tx.query<{ orgId: string; quantity: number }>('SELECT org_id AS "orgId", quantity FROM batch_holdings WHERE batch_id = $1', [batchId]),
    () => tx.query(
      `SELECT scanned_at AS "scannedAt", lat::float8 AS lat, lon::float8 AS lon, device_hash AS "deviceHash", ip_hash AS "ipHash",
              result->>'indicator' AS result FROM qr_scans WHERE batch_id = $1 ORDER BY scanned_at DESC LIMIT $2`, [batchId, SCAN_LIMIT]),
    () => tx.query(
      `SELECT id, from_org AS "fromOrg", to_org AS "toOrg", quantity, status, created_at AS "createdAt"
       FROM transfers WHERE batch_id = $1 ORDER BY created_at DESC LIMIT $2`, [batchId, TRANSFER_LIMIT]),
    () => tx.query(
      `SELECT event_type AS type, actor_org AS "actorOrg", occurred_at AS "occurredAt", quantity
       FROM supply_chain_events WHERE batch_id = $1 ORDER BY sequence DESC LIMIT $2`, [batchId, EVENT_LIMIT]),
    () => tx.query(
      `SELECT kind || ':' || reason AS kind, created_at AS at, org_id AS "actorOrg" FROM blocked_attempts WHERE batch_id = $1
       ORDER BY created_at DESC LIMIT $2`, [batchId, ATTEMPT_LIMIT]),
  ]);
  const orgIds = [...new Set([...holdings.rows.map((h) => h.orgId), ...events.rows.map((e) => e.actorOrg as string)])];
  return {
    subject: { type: 'batch', id: batchId, batchId, tenantId: batch.tenant_id },
    now: new Date().toISOString(),
    context: {
      batch: {
        initialQuantity: batch.initial_quantity, expiryDate: `${batch.expiry_date}T23:59:59Z`, status: batch.status,
        qrStatus: qr.rows[0]?.status ?? '', totalSold: Number(sold.rows[0]?.n ?? 0), totalTransferred: Number(moved.rows[0]?.n ?? 0),
        holdings: holdings.rows,
      },
      scans: scans.rows, transfers: transfers.rows, events: events.rows, blockedAttempts: attempts.rows,
      actorHistory: await actorHistory(tx, batchId, orgIds),
      chainVerified: await chainVerified(tx, batchId, batch.ledger_status),
    },
  };
}
