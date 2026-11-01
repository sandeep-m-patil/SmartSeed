import type { Config } from '../config';
import type { Db, Tx } from '../db/db';
import { sha256Hex } from '../lib/crypto';
import { enqueue } from '../jobs/queue';
import { hashQrToken } from '../qr/service';
import {
  buildWarnings, deriveIndicator, type ChainStatus, type DigitalIdentity, type InvestigationState, type RiskLevel,
  type ScanActivity, type Verification,
} from './indicator';

const SCORE_DEBOUNCE_MS = 2_000;
const COORD_DECIMALS = 2; // ~1 km: precise farmer location is never stored
const SUSPICIOUS_LEVELS: RiskLevel[] = ['HIGH', 'CRITICAL'];

export interface ScanContext {
  ip: string;
  deviceId?: string | undefined;
  lat?: number | undefined;
  lon?: number | undefined;
}

interface QrBatchRow {
  qr_id: string; tenant_id: string; batch_id: string; kind: 'batch' | 'package'; qr_status: string; serial_no: number | null;
  batch_code: string; manufacturing_date: string; expiry_date: string; is_expired: boolean; ledger_status: string;
  product_name: string; brand: string; crop_type: string; variety: string; manufacturer_name: string;
}

const round = (n: number | undefined): number | null => (n === undefined ? null : Number(n.toFixed(COORD_DECIMALS)));

async function chainStatus(tx: Tx, batchId: string, ledger: string): Promise<ChainStatus> {
  const res = await tx.query<{ total: string; committed: string; failed: string }>(
    `SELECT count(*) AS total, count(*) FILTER (WHERE t.status = 'committed') AS committed,
            count(*) FILTER (WHERE t.status = 'failed') AS failed
     FROM blockchain_transactions t JOIN supply_chain_events e ON e.id = t.event_id WHERE e.batch_id = $1`, [batchId]);
  const { total, committed, failed } = res.rows[0] as { total: string; committed: string; failed: string };
  if (ledger === 'mismatch' || Number(failed) > 0) return 'FAILED';
  return Number(total) > 0 && total === committed ? 'VERIFIED' : 'UNVERIFIED';
}

async function riskAndInvestigation(tx: Tx, batchId: string) {
  const risk = await tx.query<{ score: number; level: RiskLevel }>(
    'SELECT score, level FROM risk_scores WHERE batch_id = $1 ORDER BY computed_at DESC LIMIT 1', [batchId]);
  const alerts = await tx.query<{ alert_type: string; status: string; outcome: string | null }>(
    `SELECT a.alert_type, a.status, a.resolution->>'outcome' AS outcome FROM alerts a WHERE a.batch_id = $1
       AND (a.status IN ('open', 'investigating') OR a.resolution->>'outcome' = 'confirmed_counterfeit')`, [batchId]);
  const latest = risk.rows[0];
  const open = alerts.rows.filter((a) => a.status === 'open' || a.status === 'investigating');
  const level: RiskLevel = latest?.level ?? 'LOW';
  const investigation: InvestigationState = alerts.rows.some((a) => a.outcome === 'confirmed_counterfeit')
    ? 'CONFIRMED_COUNTERFEIT' : open.length > 0 ? 'UNDER_INVESTIGATION' : 'NONE';
  const scanActivity: ScanActivity =
    SUSPICIOUS_LEVELS.includes(level) || open.some((a) => a.alert_type.startsWith('SCAN')) ? 'SUSPICIOUS' : 'NORMAL';
  return { score: latest?.score ?? 0, level, assessed: Boolean(latest), investigation, scanActivity };
}

async function journey(tx: Tx, batchId: string) {
  const res = await tx.query<{ event_type: string; occurred_at: Date; org_type: string; chain_status: string | null }>(
    `SELECT e.event_type, e.occurred_at, o.type AS org_type, t.status AS chain_status FROM supply_chain_events e JOIN organizations o ON o.id = e.actor_org
     LEFT JOIN blockchain_transactions t ON t.event_id = e.id WHERE e.batch_id = $1 AND e.event_type IN ('batch_registered', 'transfer_received', 'retail_sale') ORDER BY e.sequence`, [batchId]);
  const labels: Record<string, string> = { batch_registered: 'MANUFACTURED', transfer_received: 'RECEIVED', retail_sale: 'SOLD' };
  return res.rows.map((r) => ({ step: labels[r.event_type], orgType: r.org_type, at: r.occurred_at, status: r.chain_status === 'committed' ? 'CONFIRMED' : r.chain_status === 'failed' ? 'FAILED' : 'PENDING' }));
}

async function logScan(tx: Tx, row: QrBatchRow, ctx: ScanContext, config: Pick<Config, 'FIELD_ENCRYPTION_KEY'>, result: object, chain: boolean) {
  const salted = (v: string) => sha256Hex(`${config.FIELD_ENCRYPTION_KEY}:${v}`);
  await tx.query(
    `INSERT INTO qr_scans (qr_id, tenant_id, batch_id, ip_hash, device_hash, lat, lon, result, chain_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [row.qr_id, row.tenant_id, row.batch_id, salted(ctx.ip), ctx.deviceId ? salted(ctx.deviceId) : null, round(ctx.lat), round(ctx.lon), JSON.stringify(result), chain]);
  await enqueue(tx, { type: 'score_batch', payload: { batchId: row.batch_id }, dedupeKey: `score:${row.batch_id}`, delayMs: SCORE_DEBOUNCE_MS });
}

const UNKNOWN_RESPONSE = {
  product: null, manufacturer: null, batch: null, certifications: [], journey: [],
  verification: { digitalIdentity: 'UNKNOWN', blockchain: 'UNVERIFIED', scanActivity: 'NORMAL', investigation: 'NONE' } as Verification,
  risk: { score: 0, level: 'LOW', assessed: false }, indicator: 'RED', warnings: ['QR_UNKNOWN'],
};

export function createVerifier(db: Db, config: Pick<Config, 'FIELD_ENCRYPTION_KEY'>) {
  /** Public, unauthenticated verification of a scanned QR token. Returns only the simplified passport. */
  async function verify(token: string, ctx: ScanContext) {
    return db.withSystem(async (tx) => {
      const found = await tx.query<QrBatchRow>(
        `SELECT q.id AS qr_id, q.tenant_id, q.batch_id, q.kind, q.status AS qr_status, pk.serial_no, b.batch_code,
                b.manufacturing_date, b.expiry_date, (b.expiry_date < CURRENT_DATE) AS is_expired, b.ledger_status,
                p.name AS product_name, p.brand, p.crop_type, p.variety, mo.legal_name AS manufacturer_name
         FROM qr_codes q JOIN seed_batches b ON b.id = q.batch_id JOIN products p ON p.id = b.product_id
         JOIN organizations mo ON mo.id = b.manufacturer_org_id LEFT JOIN packages pk ON pk.id = q.package_id
         WHERE q.token_hash = $1`, [hashQrToken(token)]);
      const row = found.rows[0];
      if (!row) return { ...UNKNOWN_RESPONSE, asOf: new Date().toISOString() };

      const chain = await chainStatus(tx, row.batch_id, row.ledger_status);
      const risk = await riskAndInvestigation(tx, row.batch_id);
      const identity: DigitalIdentity = row.qr_status === 'active' ? 'VALID' : 'REVOKED';
      const verification: Verification = { digitalIdentity: identity, blockchain: chain, scanActivity: risk.scanActivity, investigation: risk.investigation };
      const indicator = deriveIndicator(verification, risk.level, row.is_expired);
      const certs = await tx.query(
        `SELECT type, issuer, number, valid_to AS "validTo" FROM certifications WHERE batch_id = $1 OR product_id = (SELECT product_id FROM seed_batches WHERE id = $1)`, [row.batch_id]);
      await logScan(tx, row, ctx, config, { indicator, ...verification }, chain === 'VERIFIED');
      return {
        product: { name: row.product_name, brand: row.brand, cropType: row.crop_type, variety: row.variety },
        manufacturer: { name: row.manufacturer_name },
        batch: { code: row.batch_code, mfgDate: row.manufacturing_date, expiryDate: row.expiry_date, expired: row.is_expired },
        package: row.kind === 'package' ? { serialNo: row.serial_no } : null,
        certifications: certs.rows,
        journey: await journey(tx, row.batch_id),
        verification,
        risk: { score: risk.score, level: risk.level, assessed: risk.assessed },
        indicator,
        warnings: buildWarnings(verification, risk.level, row.is_expired, row.qr_status === 'superseded'),
        asOf: new Date().toISOString(),
      };
    });
  }

  return { verify };
}

export type Verifier = ReturnType<typeof createVerifier>;
