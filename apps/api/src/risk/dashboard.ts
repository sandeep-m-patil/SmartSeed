import type { Db } from '../db/db';
import { sequential } from '../lib/sequential';

const TREND_DAYS = 30;
const TOP_N = 10;
const DUPLICATE_DEVICE_THRESHOLD = 3;
const GEO_LIMIT = 200;
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/** tenantId null = platform-wide. Every figure comes from live queries; nothing is cached or seeded. */
export function createDashboardService(db: Db) {
  async function overview(tenantId: string | null) {
    return db.withSystem(async (tx) => {
      const one = async (sql: string) => Number((await tx.query<{ n: string }>(sql, [tenantId])).rows[0]?.n ?? 0);
      const scope = '($1::uuid IS NULL OR tenant_id = $1)';
      const [totalBatches, totalScans, suspiciousScans, highRisk, criticalAlerts, invTotal, invResolved, invPending] = await sequential([
        () => one(`SELECT count(*) AS n FROM seed_batches WHERE ${scope}`),
        () => one(`SELECT count(*) AS n FROM qr_scans WHERE ${scope}`),
        () => one(`SELECT count(*) AS n FROM qr_scans WHERE ${scope} AND (result->>'scanActivity' = 'SUSPICIOUS' OR result->>'indicator' = 'RED')`),
        () => one(`SELECT count(*) AS n FROM (SELECT DISTINCT ON (batch_id) batch_id, level FROM risk_scores WHERE ${scope} ORDER BY batch_id, computed_at DESC) l WHERE level IN ('HIGH', 'CRITICAL')`),
        () => one(`SELECT count(*) AS n FROM alerts WHERE ${scope} AND risk_score >= 75 AND status IN ('open', 'investigating')`),
        () => one(`SELECT count(*) AS n FROM investigations WHERE ${scope}`),
        () => one(`SELECT count(*) AS n FROM investigations WHERE ${scope} AND status IN ('resolved', 'false_positive')`),
        () => one(`SELECT count(*) AS n FROM investigations WHERE ${scope} AND status NOT IN ('resolved', 'false_positive')`),
      ]);
      return { totalBatches, totalScans, suspiciousScans, highRiskBatches: highRisk, criticalAlerts, investigations: { total: invTotal, resolved: invResolved, pending: invPending } };
    });
  }

  async function analytics(tenantId: string | null) {
    return db.withSystem(async (tx) => {
      const rows = async (sql: string, params: unknown[] = [tenantId]) => (await tx.query(sql, params)).rows;
      const dist = await rows(`SELECT level, count(*)::int AS count FROM (SELECT DISTINCT ON (batch_id) level FROM risk_scores
        WHERE ($1::uuid IS NULL OR tenant_id = $1) ORDER BY batch_id, computed_at DESC) l GROUP BY level`);
      return {
        riskDistribution: LEVELS.map((level) => ({ level, count: (dist.find((d) => d.level === level)?.count as number | undefined) ?? 0 })),
        dailyAnomalies: await rows(
          `SELECT to_char(date_trunc('day', detected_at), 'YYYY-MM-DD') AS day, count(*)::int AS count FROM alerts
           WHERE ($1::uuid IS NULL OR tenant_id = $1) AND detected_at > now() - make_interval(days => ${TREND_DAYS}) GROUP BY 1 ORDER BY 1`),
        geo: await rows(
          `SELECT lat::float8 AS lat, lon::float8 AS lon, count(*)::int AS count FROM qr_scans
           WHERE ($1::uuid IS NULL OR tenant_id = $1) AND lat IS NOT NULL AND (result->>'indicator' <> 'GREEN')
           GROUP BY lat, lon ORDER BY count DESC LIMIT ${GEO_LIMIT}`),
        topFlaggedBatches: await rows(
          `SELECT a.batch_id AS "batchId", b.batch_code AS "batchCode", count(*)::int AS alerts, max(a.risk_score) AS "maxScore"
           FROM alerts a JOIN seed_batches b ON b.id = a.batch_id WHERE ($1::uuid IS NULL OR a.tenant_id = $1)
           GROUP BY a.batch_id, b.batch_code ORDER BY alerts DESC, "maxScore" DESC LIMIT ${TOP_N}`),
        stakeholderActivity: await rows(
          `SELECT x.org_id AS "orgId", o.legal_name AS "orgName", count(*)::int AS "blockedAttempts" FROM blocked_attempts x
           JOIN organizations o ON o.id = x.org_id WHERE ($1::uuid IS NULL OR x.tenant_id = $1)
           GROUP BY x.org_id, o.legal_name ORDER BY "blockedAttempts" DESC LIMIT ${TOP_N}`),
        duplicateScans: await rows(
          `SELECT s.qr_id AS "qrId", b.batch_code AS "batchCode", count(DISTINCT s.device_hash)::int AS "distinctDevices", count(*)::int AS scans
           FROM qr_scans s JOIN seed_batches b ON b.id = s.batch_id WHERE ($1::uuid IS NULL OR s.tenant_id = $1)
           GROUP BY s.qr_id, b.batch_code HAVING count(DISTINCT s.device_hash) >= ${DUPLICATE_DEVICE_THRESHOLD}
           ORDER BY "distinctDevices" DESC LIMIT ${TOP_N}`),
        inventoryMismatches: (await rows(
          `SELECT (SELECT count(*) FROM supply_chain_events WHERE event_type = 'discrepancy_recorded' AND ($1::uuid IS NULL OR tenant_id = $1))::int AS discrepancies,
                  (SELECT count(*) FROM alerts WHERE alert_type = 'INVENTORY_MISMATCH' AND ($1::uuid IS NULL OR tenant_id = $1))::int AS alerts`))[0],
      };
    });
  }

  return { overview, analytics };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
