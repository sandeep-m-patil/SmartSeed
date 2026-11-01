import type { Request } from 'express';
import { decodeCursor, toPage } from '../lib/pagination';
import type { Db, Tx } from '../db/db';

interface AuditRow {
  id: string;
  created_at: Date;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: unknown;
  tenant_id: string | null;
}

/** tenantId = null lists every chain (platform administrators only; the route enforces that). */
export async function listAudit(db: Db, tenantId: string | null, q: { limit: number; cursor?: string | undefined }) {
  const cursor = decodeCursor(q.cursor);
  const query = async (tx: Tx): Promise<AuditRow[]> =>
    (
      await tx.query<AuditRow>(
        `SELECT id, created_at, actor_id, action, entity_type, entity_id, metadata, tenant_id FROM audit_logs
         WHERE ($1::uuid IS NULL OR tenant_id = $1)
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $4`,
        [tenantId, cursor?.createdAt ?? null, cursor?.id ?? null, q.limit + 1],
      )
    ).rows;
  const rows = tenantId ? await db.withTenant(tenantId, query) : await db.withSystem(query);
  return toPage(rows, q.limit);
}

export const clientIp = (req: Request): string => req.ip ?? 'unknown';
