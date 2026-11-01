import type { Db } from '../db/db';
import { notFound } from '../errors';
import type { Actor } from '../supply/actor';

/** Full digital product passport for authorised stakeholders; everything is read under the caller's RLS scope. */
export function createPassportService(db: Db) {
  async function full(actor: Actor, batchId: string) {
    return db.withActor(actor, async (tx) => {
      const b = await tx.query(
        `SELECT b.id, b.batch_code AS "batchCode", b.manufacturing_date AS "manufacturingDate", b.expiry_date AS "expiryDate",
                (b.expiry_date < CURRENT_DATE) AS expired, b.production_location AS "productionLocation", b.facility,
                b.initial_quantity AS "initialQuantity", b.unit, b.status, b.ledger_status AS "ledgerStatus", b.record_hash AS "recordHash",
                p.id AS "productId", p.name AS "productName", p.brand, p.crop_type AS "cropType", p.variety, p.category,
                p.regulatory_ids AS "regulatoryIds", mo.legal_name AS "manufacturerName"
         FROM seed_batches b JOIN products p ON p.id = b.product_id LEFT JOIN organizations mo ON mo.id = b.manufacturer_org_id
         WHERE b.id = $1`, [batchId]);
      if (!b.rows[0]) throw notFound('Batch not found');
      const certs = await tx.query(
        'SELECT type, issuer, number, valid_from AS "validFrom", valid_to AS "validTo" FROM certifications WHERE batch_id = $1', [batchId]);
      const qrs = await tx.query('SELECT id, kind, status, issued_at AS "issuedAt" FROM qr_codes WHERE batch_id = $1 AND kind = \'batch\' ORDER BY issued_at DESC', [batchId]);
      const events = await tx.query(
        `SELECT e.sequence, e.event_type AS "eventType", e.occurred_at AS "occurredAt", e.quantity,
                ao.legal_name AS "actorName", co.legal_name AS "counterpartyName", e.record_hash AS "recordHash",
                t.status AS "chainStatus", t.fabric_tx_id AS "chainTxId", t.block_number AS "blockNumber"
         FROM supply_chain_events e LEFT JOIN organizations ao ON ao.id = e.actor_org LEFT JOIN organizations co ON co.id = e.counterparty_org
         LEFT JOIN blockchain_transactions t ON t.event_id = e.id WHERE e.batch_id = $1 ORDER BY e.sequence`, [batchId]);
      const risk = await tx.query(
        'SELECT score, level, computed_at AS "computedAt" FROM risk_scores WHERE batch_id = $1 ORDER BY computed_at DESC LIMIT 1', [batchId]);
      const warnings = await tx.query(
        `SELECT id, alert_type AS "alertType", severity, status, summary FROM alerts WHERE batch_id = $1 AND status IN ('open', 'investigating')`, [batchId]);
      return { ...b.rows[0], certifications: certs.rows, qrCodes: qrs.rows, journey: events.rows, risk: risk.rows[0] ?? null, investigationWarnings: warnings.rows };
    });
  }
  return { full };
}

export type PassportService = ReturnType<typeof createPassportService>;
