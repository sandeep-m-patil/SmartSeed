import type { Tx } from '../db/db';
import { sequential } from '../lib/sequential';

const SCAN_LIMIT = 200;
const ROW_LIMIT = 100;

export interface Evidence {
  batch: Record<string, unknown>;
  scans: Record<string, unknown>[];
  events: Record<string, unknown>[];
  transfers: Record<string, unknown>[];
  prediction: Record<string, unknown> | null;
  alerts: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  reports: Record<string, unknown>[];
  /** Every record id a report is allowed to cite, in `kind:uuid` form. */
  refs: Set<string>;
}

/** Read-only retrieval of every record an investigation may rely on. Nothing else can be cited. */
export async function gatherEvidence(tx: Tx, batchId: string): Promise<Evidence> {
  const q = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rows as Record<string, unknown>[];
  const [batch, scans, events, transfers, prediction, alerts, attempts, reports] = await sequential([
    () => q(`SELECT b.id, b.batch_code AS "batchCode", b.status, b.expiry_date AS "expiryDate", b.initial_quantity AS "initialQuantity",
              b.ledger_status AS "ledgerStatus", p.name AS "productName", p.brand FROM seed_batches b JOIN products p ON p.id = b.product_id WHERE b.id = $1`, [batchId]),
    () => q(`SELECT id, scanned_at AS "scannedAt", lat::float8 AS lat, lon::float8 AS lon, device_hash IS NOT NULL AS "hasDevice",
              left(device_hash, 8) AS "deviceTag", result->>'indicator' AS indicator FROM qr_scans WHERE batch_id = $1
       ORDER BY scanned_at DESC LIMIT $2`, [batchId, SCAN_LIMIT]),
    () => q(`SELECT e.id, e.sequence, e.event_type AS "eventType", e.occurred_at AS "occurredAt", e.quantity, t.status AS "chainStatus",
              t.fabric_tx_id AS "chainTxId", ao.type AS "actorType", co.type AS "counterpartyType"
       FROM supply_chain_events e LEFT JOIN blockchain_transactions t ON t.event_id = e.id
       LEFT JOIN organizations ao ON ao.id = e.actor_org LEFT JOIN organizations co ON co.id = e.counterparty_org
       WHERE e.batch_id = $1 ORDER BY e.sequence LIMIT $2`, [batchId, ROW_LIMIT]),
    () => q(`SELECT id, status, quantity, received_quantity AS "receivedQuantity", created_at AS "createdAt" FROM transfers WHERE batch_id = $1
       ORDER BY created_at LIMIT $2`, [batchId, ROW_LIMIT]),
    () => q(`SELECT id, risk_score AS "riskScore", level, category, severity, confidence, indicators, mode, model_version AS "modelVersion",
              recommended_action AS "recommendedAction", created_at AS "createdAt" FROM anomaly_predictions WHERE batch_id = $1
       ORDER BY created_at DESC LIMIT 1`, [batchId]),
    () => q(`SELECT id, alert_type AS "alertType", severity, status, risk_score AS "riskScore", summary, detected_at AS "detectedAt"
       FROM alerts WHERE batch_id = $1 ORDER BY detected_at DESC LIMIT $2`, [batchId, ROW_LIMIT]),
    () => q(`SELECT id, kind, reason, created_at AS "createdAt" FROM blocked_attempts WHERE batch_id = $1 ORDER BY created_at DESC LIMIT $2`, [batchId, ROW_LIMIT]),
    () => q(`SELECT id, region, created_at AS "createdAt", description IS NOT NULL AS "hasDescription" FROM counterfeit_reports WHERE batch_id = $1
       ORDER BY created_at DESC LIMIT $2`, [batchId, ROW_LIMIT]),
  ]);
  const refs = new Set<string>();
  const tag = (kind: string, rows: Record<string, unknown>[]) => rows.forEach((r) => refs.add(`${kind}:${r.id}`));
  tag('batch', batch); tag('scan', scans); tag('event', events); tag('transfer', transfers);
  tag('prediction', prediction); tag('alert', alerts); tag('attempt', attempts); tag('report', reports);
  return { batch: batch[0] ?? {}, scans, events, transfers, prediction: prediction[0] ?? null, alerts, attempts, reports, refs };
}
