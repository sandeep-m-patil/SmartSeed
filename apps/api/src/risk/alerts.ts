import type { Tx } from '../db/db';

export interface RaiseAlert {
  tenantId: string;
  batchId: string;
  alertType: string;
  severity: string;
  riskScore: number;
  summary: string;
}

/**
 * One open alert per (batch, type): repeat detections raise the score and refresh the summary of
 * the existing alert instead of creating duplicates. Returns whether a NEW alert was created.
 */
export async function raiseAlert(tx: Tx, a: RaiseAlert): Promise<{ id: string; created: boolean }> {
  const res = await tx.query<{ id: string; created: boolean }>(
    `INSERT INTO alerts (tenant_id, batch_id, alert_type, severity, risk_score, summary, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (dedupe_key) WHERE status IN ('open', 'investigating')
     DO UPDATE SET risk_score = GREATEST(alerts.risk_score, EXCLUDED.risk_score), severity = EXCLUDED.severity,
                   summary = EXCLUDED.summary, updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [a.tenantId, a.batchId, a.alertType, a.severity, a.riskScore, a.summary, `${a.batchId}:${a.alertType}`],
  );
  return res.rows[0] as { id: string; created: boolean };
}
