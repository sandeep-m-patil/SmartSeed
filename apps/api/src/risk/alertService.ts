import type { Db } from '../db/db';
import { AppError, notFound } from '../errors';
import { writeAudit } from '../audit/audit';
import { enqueue } from '../jobs/queue';
import { decodeCursor, toPage } from '../lib/pagination';

const LEVEL_RANGES: Record<string, [number, number]> = { LOW: [0, 24], MEDIUM: [25, 49], HIGH: [50, 74], CRITICAL: [75, 100] };

export interface AlertFilters {
  limit: number;
  cursor?: string | undefined;
  level?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  productId?: string | undefined;
  batchId?: string | undefined;
  orgId?: string | undefined;
  investigationStatus?: string | undefined;
}

/** tenantId null = platform administrator (all tenants). */
export interface AlertScope { tenantId: string | null; userId: string; ip: string }

interface AlertRow {
  id: string; created_at: Date; batch_id: string; batch_code: string; product_name: string; alert_type: string; severity: string;
  risk_score: number; status: string; detected_at: Date; assignee_id: string | null; assignee_name: string | null; summary: string;
  investigation_id: string | null; investigation_status: string | null; resolution: unknown;
}

const toDto = (r: AlertRow) => ({
  id: r.id, batchId: r.batch_id, batchCode: r.batch_code, productName: r.product_name, alertType: r.alert_type, severity: r.severity,
  riskScore: r.risk_score, status: r.status, detectedAt: r.detected_at, assigneeId: r.assignee_id, assigneeName: r.assignee_name,
  summary: r.summary, investigationId: r.investigation_id, investigationStatus: r.investigation_status, resolution: r.resolution,
});

export function createAlertService(db: Db) {
  async function list(scope: AlertScope, f: AlertFilters) {
    const cursor = decodeCursor(f.cursor);
    const [lo, hi] = f.level ? (LEVEL_RANGES[f.level] ?? [0, 100]) : [0, 100];
    const rows = await db.withSystem(async (tx) =>
      (await tx.query<AlertRow>(
        `SELECT a.*, a.detected_at AS created_at, b.batch_code, p.name AS product_name, u.full_name AS assignee_name,
                i.id AS investigation_id, i.status AS investigation_status
         FROM alerts a JOIN seed_batches b ON b.id = a.batch_id JOIN products p ON p.id = b.product_id
         LEFT JOIN users u ON u.id = a.assignee_id LEFT JOIN investigations i ON i.alert_id = a.id
         WHERE ($1::uuid IS NULL OR a.tenant_id = $1) AND a.risk_score BETWEEN $2 AND $3
           AND ($4::alert_status IS NULL OR a.status = $4) AND ($5::timestamptz IS NULL OR a.detected_at >= $5)
           AND ($6::timestamptz IS NULL OR a.detected_at <= $6) AND ($7::uuid IS NULL OR b.product_id = $7)
           AND ($8::uuid IS NULL OR a.batch_id = $8)
           AND ($9::uuid IS NULL OR EXISTS (SELECT 1 FROM supply_chain_events e WHERE e.batch_id = a.batch_id AND (e.actor_org = $9 OR e.counterparty_org = $9)))
           AND ($10::investigation_status IS NULL OR i.status = $10)
           AND ($11::timestamptz IS NULL OR (a.detected_at, a.id) < ($11, $12::uuid))
         ORDER BY a.detected_at DESC, a.id DESC LIMIT $13`,
        [scope.tenantId, lo, hi, f.status ?? null, f.from ?? null, f.to ?? null, f.productId ?? null, f.batchId ?? null, f.orgId ?? null,
          f.investigationStatus ?? null, cursor?.createdAt ?? null, cursor?.id ?? null, f.limit + 1])).rows);
    const page = toPage(rows, f.limit);
    return { items: page.items.map(toDto), nextCursor: page.nextCursor };
  }

  async function get(scope: AlertScope, id: string) {
    return db.withSystem(async (tx) => {
      const r = await tx.query<AlertRow>(
        `SELECT a.*, a.detected_at AS created_at, b.batch_code, p.name AS product_name, u.full_name AS assignee_name,
                i.id AS investigation_id, i.status AS investigation_status
         FROM alerts a JOIN seed_batches b ON b.id = a.batch_id JOIN products p ON p.id = b.product_id
         LEFT JOIN users u ON u.id = a.assignee_id LEFT JOIN investigations i ON i.alert_id = a.id
         WHERE a.id = $1 AND ($2::uuid IS NULL OR a.tenant_id = $2)`, [id, scope.tenantId]);
      if (!r.rows[0]) throw notFound('Alert not found');
      return toDto(r.rows[0]);
    });
  }

  /** The assignee must be an active user able to decide investigations (tenant admin, or platform admin). */
  async function assign(scope: AlertScope, id: string, assigneeId: string) {
    return db.withSystem(async (tx) => {
      const alert = await tx.query<{ tenant_id: string }>('SELECT tenant_id FROM alerts WHERE id = $1 AND ($2::uuid IS NULL OR tenant_id = $2) FOR UPDATE', [id, scope.tenantId]);
      if (!alert.rows[0]) throw notFound('Alert not found');
      const user = await tx.query(
        `SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
         WHERE u.id = $1 AND u.status = 'active' AND ((u.tenant_id = $2 AND r.name = 'company_admin') OR r.name = 'platform_admin')`,
        [assigneeId, alert.rows[0].tenant_id]);
      if (!user.rowCount) throw new AppError(400, 'INVALID_ASSIGNEE', 'Assignee must be an investigator for this organization');
      await tx.query('UPDATE alerts SET assignee_id = $2, updated_at = now() WHERE id = $1', [id, assigneeId]);
      await enqueue(tx, { type: 'notify_assignment', payload: { alertId: id, assigneeId }, dedupeKey: `assign:${id}:${assigneeId}` });
      await writeAudit(tx, {
        tenantId: alert.rows[0].tenant_id, actorId: scope.userId, action: 'alert.assigned', entityType: 'alert', entityId: id, ip: scope.ip, metadata: { assigneeId },
      });
      return { id, assigneeId };
    });
  }

  return { list, get, assign };
}

export type AlertService = ReturnType<typeof createAlertService>;
