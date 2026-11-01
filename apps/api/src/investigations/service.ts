import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { Db, Tx } from '../db/db';
import { AppError, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { enqueue } from '../jobs/queue';
import { decodeCursor, toPage } from '../lib/pagination';
import { gatherEvidence } from './evidence';
import { buildEvidenceReport } from './fallback';
import { runInvestigationAgent, type LlmProvider } from './llm';
import { sanitizeReport, type AgentReport, type FinalReport } from './report';

export const INVESTIGATION_ACTIONS = [
  'mark_under_investigation', 'request_verification', 'confirm_suspicious', 'dismiss_false_positive',
  'escalate_manufacturer', 'escalate_authority', 'mark_resolved',
] as const;
export type InvestigationAction = (typeof INVESTIGATION_ACTIONS)[number];
export const OUTCOMES = ['confirmed_counterfeit', 'cleared', 'inconclusive'] as const;

/** Who is deciding: a tenant user (own tenant only) or a platform administrator (tenantId null). */
export interface Scope {
  tenantId: string | null;
  userId: string;
  ip: string;
}

const STATUS_BY_ACTION: Record<InvestigationAction, string> = {
  mark_under_investigation: 'under_investigation', request_verification: 'verification_requested',
  confirm_suspicious: 'confirmed_suspicious', dismiss_false_positive: 'false_positive',
  escalate_manufacturer: 'escalated_manufacturer', escalate_authority: 'escalated_authority', mark_resolved: 'resolved',
};

const HOLD_ACTIONS: InvestigationAction[] = ['mark_under_investigation', 'confirm_suspicious'];
const CLOSED = ['false_positive', 'resolved'];

interface InvRow {
  id: string; tenant_id: string; alert_id: string; batch_id: string; status: string; requires_human_review: boolean;
  report: Record<string, unknown> | null; generated_by: string | null; created_at: Date; updated_at: Date;
}

const toDto = (r: InvRow) => ({
  id: r.id, alertId: r.alert_id, batchId: r.batch_id, status: r.status, requiresHumanReview: r.requires_human_review,
  generatedBy: r.generated_by, report: r.report, createdAt: r.created_at, updatedAt: r.updated_at,
});

async function setBatchHold(tx: Tx, batchId: string, hold: boolean): Promise<void> {
  await tx.query('UPDATE transfers SET under_investigation = $2, updated_at = now() WHERE batch_id = $1 AND status IN (\'created\', \'dispatched\', \'in_transit\')', [batchId, hold]);
  await tx.query(
    hold ? "UPDATE seed_batches SET status = 'on_hold' WHERE id = $1 AND status = 'active'"
         : "UPDATE seed_batches SET status = 'active' WHERE id = $1 AND status = 'on_hold'", [batchId]);
}

async function otherOpenInvestigations(tx: Tx, batchId: string, exceptId: string): Promise<boolean> {
  const res = await tx.query(
    `SELECT 1 FROM investigations WHERE batch_id = $1 AND id <> $2 AND status NOT IN ('false_positive', 'resolved') LIMIT 1`, [batchId, exceptId]);
  return (res.rowCount ?? 0) > 0;
}

export function createInvestigationService(deps: { db: Db; llm?: LlmProvider | undefined; logger: Logger }) {
  const { db, llm, logger } = deps;

  async function buildReport(batchEvidence: Awaited<ReturnType<typeof gatherEvidence>>, alert: { alert_type: string; summary: string; severity: string }) {
    const level = batchEvidence.prediction ? String(batchEvidence.prediction.level) : alert.severity;
    const fallback = () => ({ report: buildEvidenceReport(batchEvidence, alert.alert_type, level), by: 'rules' });
    if (!llm) return fallback();
    try {
      const raw = await runInvestigationAgent(llm, batchEvidence, `${alert.alert_type}: ${alert.summary}`);
      return { report: raw, by: llm.name };
    } catch (err) {
      logger.warn({ err: String(err) }, 'LLM investigation failed validation; using evidence-only report');
      return fallback();
    }
  }

  /** Creates the investigation for an alert (idempotent per alert). */
  async function investigate(alertId: string): Promise<string | null> {
    const loaded = await db.withSystem(async (tx) => {
      const a = await tx.query<{ tenant_id: string; batch_id: string; alert_type: string; summary: string; severity: string; risk_score: number }>(
        'SELECT tenant_id, batch_id, alert_type, summary, severity, risk_score FROM alerts WHERE id = $1', [alertId]);
      const alert = a.rows[0];
      if (!alert) return null;
      return { alert, evidence: await gatherEvidence(tx, alert.batch_id) };
    });
    if (!loaded) return null;
    const { report, by } = await buildReport(loaded.evidence, loaded.alert);
    const clean = sanitizeReport(report, loaded.evidence.refs);
    const investigationId = randomUUID();
    const final: FinalReport = {
      ...clean.report, investigationId, batchId: loaded.alert.batch_id, riskScore: loaded.alert.risk_score,
      riskCategory: loaded.alert.alert_type, droppedFindings: clean.dropped,
    };
    return db.withSystem(async (tx) => {
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO investigations (id, tenant_id, alert_id, batch_id, requires_human_review, report, generated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (alert_id) DO NOTHING RETURNING id`,
        [investigationId, loaded.alert.tenant_id, alertId, loaded.alert.batch_id, loaded.alert.severity === 'CRITICAL' || loaded.alert.risk_score >= 75, JSON.stringify(final), by]);
      if (!ins.rows[0]) return null;
      for (const f of final.findings) {
        await tx.query(
          'INSERT INTO investigation_evidence (investigation_id, kind, record_type, record_id, summary) VALUES ($1,$2,$3,$4,$5)',
          [investigationId, f.kind, f.evidenceRefs[0]?.split(':')[0] ?? null, f.evidenceRefs[0]?.split(':')[1] ?? null, f.text]);
      }
      await writeAudit(tx, { tenantId: loaded.alert.tenant_id, actorId: null, action: 'investigation.created', entityType: 'investigation', entityId: investigationId, metadata: { generatedBy: by, dropped: clean.dropped } });
      return investigationId;
    });
  }

  async function list(scope: Scope, q: { limit: number; cursor?: string | undefined; status?: string | undefined }) {
    const cursor = decodeCursor(q.cursor);
    const rows = await db.withSystem(async (tx) =>
      (await tx.query<InvRow>(
        `SELECT * FROM investigations WHERE ($1::uuid IS NULL OR tenant_id = $1) AND ($2::investigation_status IS NULL OR status = $2)
           AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4::uuid)) ORDER BY created_at DESC, id DESC LIMIT $5`,
        [scope.tenantId, q.status ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1])).rows);
    const page = toPage(rows, q.limit);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  async function get(scope: Scope, id: string) {
    return db.withSystem(async (tx) => {
      const res = await tx.query<InvRow>('SELECT * FROM investigations WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2)', [id, scope.tenantId]);
      if (!res.rows[0]) throw notFound('Investigation not found');
      const actions = await tx.query(
        `SELECT a.action, a.note, a.created_at AS "createdAt", u.full_name AS "actorName" FROM investigation_actions a
         JOIN users u ON u.id = a.actor_id WHERE a.investigation_id = $1 ORDER BY a.created_at`, [id]);
      const evidence = await tx.query('SELECT kind, record_type AS "recordType", record_id AS "recordId", summary FROM investigation_evidence WHERE investigation_id = $1', [id]);
      return { ...toDto(res.rows[0]), actions: actions.rows, evidence: evidence.rows };
    });
  }

  async function applyEffects(tx: Tx, inv: InvRow, action: InvestigationAction, input: { outcome?: string | undefined; note?: string | undefined }, scope: Scope) {
    if (HOLD_ACTIONS.includes(action)) await setBatchHold(tx, inv.batch_id, true);
    const alertStatus = action === 'mark_resolved' ? 'resolved' : action === 'dismiss_false_positive' ? 'dismissed' : 'investigating';
    const resolution = alertStatus === 'investigating' ? null
      : JSON.stringify({ outcome: action === 'dismiss_false_positive' ? 'false_positive' : input.outcome, note: input.note ?? null, resolvedBy: scope.userId, at: new Date().toISOString() });
    await tx.query('UPDATE alerts SET status = $2, resolution = COALESCE($3::jsonb, resolution), updated_at = now() WHERE id = $1', [inv.alert_id, alertStatus, resolution]);
    if (CLOSED.includes(STATUS_BY_ACTION[action]) && !(await otherOpenInvestigations(tx, inv.batch_id, inv.id))) await setBatchHold(tx, inv.batch_id, false);
    const notify = action === 'escalate_authority' ? 'authority' : action === 'escalate_manufacturer' ? 'manufacturer' : alertStatus === 'investigating' ? null : 'resolution';
    if (notify) {
      await enqueue(tx, { type: 'notify_investigation', payload: { investigationId: inv.id, audience: notify, action }, dedupeKey: `inv-notify:${inv.id}:${action}` });
    }
  }

  /** Every decision is human-initiated, recorded in the append-only actions table and the audit chain. */
  async function act(scope: Scope, id: string, input: { action: InvestigationAction; note?: string | undefined; outcome?: string | undefined }) {
    if (input.action === 'mark_resolved' && !input.outcome) throw new AppError(400, 'OUTCOME_REQUIRED', 'An outcome is required to resolve an investigation');
    return db.withSystem(async (tx) => {
      const res = await tx.query<InvRow>('SELECT * FROM investigations WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE', [id, scope.tenantId]);
      const inv = res.rows[0];
      if (!inv) throw notFound('Investigation not found');
      if (CLOSED.includes(inv.status)) throw new AppError(409, 'INVESTIGATION_CLOSED', 'This investigation is already closed');
      await tx.query('UPDATE investigations SET status = $2, updated_at = now() WHERE id = $1', [id, STATUS_BY_ACTION[input.action]]);
      await tx.query('INSERT INTO investigation_actions (investigation_id, action, actor_id, note) VALUES ($1,$2,$3,$4)', [id, input.action, scope.userId, input.note ?? null]);
      await applyEffects(tx, inv, input.action, input, scope);
      await writeAudit(tx, {
        tenantId: inv.tenant_id, actorId: scope.userId, action: `investigation.${input.action}`, entityType: 'investigation', entityId: id,
        ip: scope.ip, metadata: { outcome: input.outcome ?? null },
      });
      return { id, status: STATUS_BY_ACTION[input.action] };
    });
  }

  return { investigate, list, get, act };
}

export type InvestigationService = ReturnType<typeof createInvestigationService>;
