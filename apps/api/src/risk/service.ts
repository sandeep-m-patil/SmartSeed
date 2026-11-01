import type { Logger } from 'pino';
import type { Db } from '../db/db';
import { enqueue } from '../jobs/queue';
import type { AiScore, AiScorer } from './aiClient';
import { raiseAlert } from './alerts';
import { buildScoreRequest } from './context';

const ALERT_LEVELS = ['HIGH', 'CRITICAL'];

const ALERT_TYPE_BY_FAMILY: Record<string, string> = {
  scan_behaviour: 'SCAN_ANOMALY',
  geo: 'SCAN_GEO_ANOMALY',
  chain_integrity: 'CHAIN_INTEGRITY',
  inventory: 'INVENTORY_MISMATCH',
  expiry: 'EXPIRY_RISK',
  actor_history: 'ACTOR_RISK',
  ml: 'ML_ANOMALY',
};

/** The alert type follows the family of the strongest indicator so related findings dedupe together. */
export function alertTypeFor(score: AiScore): string {
  const top = [...score.indicators].sort((a, b) => b.normalizedSignal - a.normalizedSignal)[0];
  return ALERT_TYPE_BY_FAMILY[top?.family ?? ''] ?? ALERT_TYPE_BY_FAMILY[score.category] ?? 'RISK_HIGH';
}

export function createRiskService(deps: { db: Db; scorer: AiScorer; logger: Logger }) {
  const { db, scorer, logger } = deps;

  /** Scores a batch, stores prediction + score history, and raises a deduplicated alert for HIGH/CRITICAL. */
  async function scoreBatch(batchId: string): Promise<AiScore | null> {
    const request = await db.withSystem((tx) => buildScoreRequest(tx, batchId));
    if (!request) return null;
    const score = await scorer.score(request);
    await db.withSystem(async (tx) => {
      const tenantId = request.subject.tenantId;
      await tx.query(
        `INSERT INTO model_versions (name, version, mode, data_description) VALUES ('detector', $1, $2, $3) ON CONFLICT (name, version) DO NOTHING`,
        [score.modelVersion, score.mode, (score.notes ?? []).join(' ')]);
      await tx.query(
        `INSERT INTO anomaly_predictions (tenant_id, batch_id, subject_type, subject_id, model_version, mode, risk_score, level, category,
           severity, confidence, indicators, evidence, recommended_action, config_version)
         VALUES ($1,$2,'batch',$2::uuid::text,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [tenantId, batchId, score.modelVersion, score.mode, score.riskScore, score.level, score.category, score.severity,
          score.confidence, JSON.stringify(score.indicators), JSON.stringify(score.evidence), score.recommendedAction, score.configVersion]);
      await tx.query(
        'INSERT INTO risk_scores (tenant_id, batch_id, score, level, components, config_version) VALUES ($1,$2,$3,$4,$5,$6)',
        [tenantId, batchId, score.riskScore, score.level, JSON.stringify(score.componentScores), score.configVersion]);
      if (!ALERT_LEVELS.includes(score.level)) return;
      const alert = await raiseAlert(tx, {
        tenantId, batchId, alertType: alertTypeFor(score), severity: score.severity, riskScore: score.riskScore,
        summary: score.indicators.slice(0, 3).map((i) => i.description).join(' ') || score.recommendedAction,
      });
      if (alert.created) {
        await enqueue(tx, { type: 'investigate', payload: { alertId: alert.id }, dedupeKey: `investigate:${alert.id}` });
        await enqueue(tx, { type: 'notify_alert', payload: { alertId: alert.id }, dedupeKey: `notify-alert:${alert.id}` });
      }
    });
    logger.info({ batchId, level: score.level, score: score.riskScore }, 'batch scored');
    return score;
  }

  return { scoreBatch };
}

export type RiskService = ReturnType<typeof createRiskService>;
