import type { Db } from '../db/db';
import { AppError } from '../errors';

export interface AttemptInfo {
  tenantId?: string | null;
  batchId?: string | null;
  /** When the batch is not known (e.g. a non-party poking a transfer), it is resolved from the transfer. */
  transferId?: string | null;
  orgId?: string | null;
  userId?: string | null;
  kind: string;
}

/**
 * Persists a rejected operation for risk analysis. It runs in its own transaction because the
 * failed business transaction has been rolled back. Failures here must never mask the original error.
 */
export async function recordBlockedAttempt(db: Db, info: AttemptInfo, err: unknown): Promise<void> {
  if (!(err instanceof AppError) || err.status >= 500) return;
  try {
    await db.withSystem((tx) =>
      tx.query(
        `INSERT INTO blocked_attempts (tenant_id, batch_id, org_id, user_id, kind, reason)
         SELECT COALESCE($1::uuid, t.tenant_id), COALESCE($2::uuid, t.batch_id), $3, $4, $5, $6
         FROM (SELECT 1) AS one LEFT JOIN transfers t ON t.id = $7::uuid`,
        [info.tenantId ?? null, info.batchId ?? null, info.orgId ?? null, info.userId ?? null, info.kind, err.code, info.transferId ?? null],
      ),
    );
  } catch {
    // best effort only
  }
}
