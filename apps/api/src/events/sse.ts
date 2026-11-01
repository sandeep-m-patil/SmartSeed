import type { Request, Response } from 'express';
import type { Db } from '../db/db';

const DEFAULT_INTERVAL_MS = 3_000;
const KEEPALIVE_EVERY = 10;

export interface StreamScope {
  tenantId: string | null; // null = platform administrator
  userId: string;
}

/**
 * Server-sent events backed by short polling, so it works unchanged across several API instances
 * (no in-process bus). Emits `alert.created` for new/updated alerts and `notification.created` for the user.
 */
export function streamEvents(req: Request, res: Response, db: Db, scope: StreamScope, intervalMs = DEFAULT_INTERVAL_MS): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  let since = new Date();
  let ticks = 0;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    const cutoff = since;
    since = new Date();
    try {
      const events = await db.withSystem(async (tx) => {
        const alerts = await tx.query(
          `SELECT id, batch_id AS "batchId", alert_type AS "alertType", severity, risk_score AS "riskScore" FROM alerts
           WHERE updated_at > $1 AND ($2::uuid IS NULL OR tenant_id = $2)`, [cutoff, scope.tenantId]);
        const notes = await tx.query("SELECT id, type, title FROM notifications WHERE user_id = $1 AND channel = 'in_app' AND created_at > $2", [scope.userId, cutoff]);
        return [
          ...alerts.rows.map((a) => ({ type: 'alert.created', ...a })),
          ...notes.rows.map((n) => ({ type: 'notification.created', ...n })),
        ];
      });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      ticks += 1;
      if (events.length === 0 && ticks % KEEPALIVE_EVERY === 0) res.write(': keepalive\n\n');
    } catch {
      // transient DB error: keep the stream open and try again next tick
    } finally {
      busy = false;
    }
  }, intervalMs);
  req.on('close', () => clearInterval(timer));
}
