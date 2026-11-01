import type { RequestHandler } from 'express';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { Db } from '../db/db';

const DURATION_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export interface Metrics {
  middleware: RequestHandler;
  /** Prometheus text endpoint; requires `Authorization: Bearer <METRICS_TOKEN>`. */
  handler(token: string): RequestHandler;
}

/**
 * Request metrics plus business-health gauges (stuck blockchain records, job backlog, open
 * alerts) computed at scrape time from the database, so alerts fire on real state.
 */
export function createMetrics(db: Db): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const duration = new Histogram({
    name: 'http_request_duration_seconds', help: 'HTTP request duration', labelNames: ['method', 'route', 'status'],
    buckets: DURATION_BUCKETS, registers: [registry],
  });
  new Counter({ name: 'http_requests_started_total', help: 'Requests started', registers: [registry] });
  const chain = new Gauge({ name: 'smartseed_chain_records', help: 'Blockchain outbox rows by status', labelNames: ['status'], registers: [registry] });
  const jobs = new Gauge({ name: 'smartseed_jobs', help: 'Background jobs by status', labelNames: ['status'], registers: [registry] });
  const oldestPending = new Gauge({ name: 'smartseed_chain_oldest_pending_seconds', help: 'Age of the oldest uncommitted ledger record', registers: [registry] });
  const alerts = new Gauge({ name: 'smartseed_open_alerts', help: 'Open or investigating alerts', labelNames: ['severity'], registers: [registry] });

  async function refreshGauges(): Promise<void> {
    await db.withSystem(async (tx) => {
      const c = await tx.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM blockchain_transactions GROUP BY status');
      chain.reset();
      c.rows.forEach((r) => chain.set({ status: r.status }, Number(r.n)));
      const j = await tx.query<{ status: string; n: string }>('SELECT status, count(*) AS n FROM jobs GROUP BY status');
      jobs.reset();
      j.rows.forEach((r) => jobs.set({ status: r.status }, Number(r.n)));
      const o = await tx.query<{ age: number | null }>("SELECT EXTRACT(EPOCH FROM now() - min(created_at))::float8 AS age FROM blockchain_transactions WHERE status IN ('pending', 'submitted')");
      oldestPending.set(o.rows[0]?.age ?? 0);
      const a = await tx.query<{ severity: string; n: string }>("SELECT severity, count(*) AS n FROM alerts WHERE status IN ('open', 'investigating') GROUP BY severity");
      alerts.reset();
      a.rows.forEach((r) => alerts.set({ severity: r.severity }, Number(r.n)));
    });
  }

  return {
    middleware: (req, res, next) => {
      const end = duration.startTimer();
      res.on('finish', () => end({ method: req.method, route: req.route?.path ?? req.baseUrl ?? 'unmatched', status: String(res.statusCode) }));
      next();
    },
    handler: (token) => async (req, res) => {
      if (req.header('authorization') !== `Bearer ${token}`) {
        res.status(401).end();
        return;
      }
      await refreshGauges();
      res.setHeader('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    },
  };
}
