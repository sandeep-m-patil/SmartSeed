import type { Db, Tx } from '../db/db';

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const MAX_ATTEMPTS = 6;

export interface JobInput {
  type: string;
  payload?: Record<string, unknown>;
  /** While a job with this key is queued/running, further enqueues are no-ops (debounce). */
  dedupeKey?: string;
  delayMs?: number;
}

export interface Job {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function enqueue(tx: Tx, job: JobInput): Promise<void> {
  await tx.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     ON CONFLICT (dedupe_key) WHERE status IN ('queued', 'running') DO NOTHING`,
    [job.type, JSON.stringify(job.payload ?? {}), job.dedupeKey ?? null, (job.delayMs ?? 0) / 1000],
  );
}

export type JobHandler = (job: Job) => Promise<void>;

/**
 * Claims due jobs (SKIP LOCKED so several workers can run), runs each handler outside the claim
 * transaction, and records success or a backed-off retry. Returns how many jobs ran.
 */
export async function runDueJobs(db: Db, handlers: Record<string, JobHandler>, limit = 10): Promise<number> {
  const claimed = await db.withSystem(async (tx) => {
    const res = await tx.query<Job>(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1 WHERE id IN (
         SELECT id FROM jobs WHERE status = 'queued' AND run_at <= now() ORDER BY run_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, type, payload, attempts`,
      [limit],
    );
    return res.rows;
  });
  for (const job of claimed) {
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`no handler for job type ${job.type}`);
      await handler(job);
      await db.withSystem((tx) => tx.query("UPDATE jobs SET status = 'done' WHERE id = $1", [job.id]));
    } catch (err) {
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** job.attempts, MAX_BACKOFF_MS);
      const final = job.attempts >= MAX_ATTEMPTS;
      await db.withSystem((tx) =>
        tx.query(
          `UPDATE jobs SET status = $2, last_error = $3, run_at = now() + make_interval(secs => $4) WHERE id = $1`,
          [job.id, final ? 'failed' : 'queued', String(err).slice(0, 500), backoff / 1000],
        ),
      );
    }
  }
  return claimed.length;
}
