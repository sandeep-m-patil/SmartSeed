import type { Db, Tx } from '../db/db';
import { AppError, notFound } from '../errors';
import { writeAudit } from '../audit/audit';

export const USAGE_METRICS = ['batches', 'users', 'scans', 'investigations'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];
/** Metrics that block creation when exceeded. Scans are metered but never block farmer verification. */
const ENFORCED: UsageMetric[] = ['batches', 'users'];

const COUNT_SQL: Record<UsageMetric, string> = {
  batches: "SELECT count(*) AS n FROM seed_batches WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())",
  users: 'SELECT count(*) AS n FROM users WHERE tenant_id = $1',
  scans: "SELECT count(*) AS n FROM qr_scans WHERE tenant_id = $1 AND scanned_at >= date_trunc('month', now())",
  investigations: "SELECT count(*) AS n FROM investigations WHERE tenant_id = $1 AND created_at >= date_trunc('month', now())",
};

interface PlanLimits { batches?: number; users?: number; scans?: number; investigations?: number }

export async function currentLimits(tx: Tx, tenantId: string): Promise<PlanLimits> {
  const res = await tx.query<{ limits: PlanLimits }>(
    `SELECT p.limits FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 1`, [tenantId]);
  return res.rows[0]?.limits ?? {};
}

export async function usageOf(tx: Tx, tenantId: string, metric: UsageMetric): Promise<number> {
  return Number((await tx.query<{ n: string }>(COUNT_SQL[metric], [tenantId])).rows[0]?.n ?? 0);
}

/** Throws 402 when creating one more would exceed the plan limit. A missing limit means unlimited. */
export async function assertWithinLimit(tx: Tx, tenantId: string, metric: UsageMetric, adding = 1): Promise<void> {
  if (!ENFORCED.includes(metric)) return;
  const limit = (await currentLimits(tx, tenantId))[metric];
  if (limit === undefined) return;
  const used = await usageOf(tx, tenantId, metric);
  if (used + adding > limit) throw new AppError(402, 'PLAN_LIMIT_EXCEEDED', `Your plan allows ${limit} ${metric}; upgrade to add more`, { metric, limit, used });
}

export interface PlanInput {
  code: string;
  name: string;
  limits: PlanLimits;
  priceMinor: number;
  currency: string;
  billingInterval?: string | undefined;
  gatewayPlanId?: string | undefined;
}

export function createBillingService(db: Db) {
  async function subscription(tenantId: string) {
    return db.withSystem(async (tx) => {
      const res = await tx.query(
        `SELECT p.code, p.name, p.limits, p.price_minor AS "priceMinor", p.currency, s.status, s.trial_ends_at AS "trialEndsAt", s.renews_at AS "renewsAt"
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 1`, [tenantId]);
      const r = res.rows[0];
      if (!r) throw notFound('No subscription');
      return { plan: { code: r.code, name: r.name, limits: r.limits, priceMinor: r.priceMinor, currency: r.currency }, status: r.status, trialEndsAt: r.trialEndsAt, renewsAt: r.renewsAt };
    });
  }

  async function usage(tenantId: string) {
    return db.withSystem(async (tx) => {
      const limits = await currentLimits(tx, tenantId);
      const out: Record<string, { used: number; limit: number | null }> = {};
      for (const m of USAGE_METRICS) out[m] = { used: await usageOf(tx, tenantId, m), limit: limits[m] ?? null };
      return out;
    });
  }

  async function invoices(tenantId: string) {
    return db.withSystem(async (tx) =>
      (await tx.query(
        `SELECT id, number, amount_minor AS "amountMinor", currency, status, period_start AS "periodStart", period_end AS "periodEnd",
                issued_at AS "issuedAt", paid_at AS "paidAt" FROM invoices WHERE tenant_id = $1 ORDER BY issued_at DESC LIMIT 100`, [tenantId])).rows);
  }

  async function listPlans() {
    return db.withSystem(async (tx) =>
      (await tx.query('SELECT code, name, limits, price_minor AS "priceMinor", currency, billing_interval AS "billingInterval", is_active AS "isActive", gateway_plan_id AS "gatewayPlanId" FROM plans ORDER BY created_at')).rows);
  }

  /** Pricing is data: operators create or change plans here; nothing is hardcoded. */
  async function upsertPlan(input: PlanInput, actorId: string, ip: string) {
    return db.withSystem(async (tx) => {
      await tx.query(
        `INSERT INTO plans (code, name, limits, price_minor, currency, billing_interval, gateway_plan_id) VALUES ($1,$2,$3,$4,$5,COALESCE($6,'month'),$7)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, limits = EXCLUDED.limits, price_minor = EXCLUDED.price_minor,
           currency = EXCLUDED.currency, billing_interval = EXCLUDED.billing_interval, gateway_plan_id = EXCLUDED.gateway_plan_id`,
        [input.code, input.name, JSON.stringify(input.limits), input.priceMinor, input.currency, input.billingInterval ?? null, input.gatewayPlanId ?? null]);
      await writeAudit(tx, { tenantId: null, actorId, action: 'plan.upserted', entityType: 'plan', entityId: input.code, ip });
      return { code: input.code };
    });
  }

  async function setTenantPlan(tenantId: string, planCode: string, status: string, actorId: string, ip: string) {
    return db.withSystem(async (tx) => {
      const plan = await tx.query<{ id: string }>('SELECT id FROM plans WHERE code = $1 AND is_active', [planCode]);
      if (!plan.rows[0]) throw notFound('Plan not found');
      const upd = await tx.query(
        `UPDATE subscriptions SET plan_id = $2, status = $3 WHERE id = (SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [tenantId, plan.rows[0].id, status]);
      if (!upd.rowCount) throw notFound('Tenant has no subscription');
      await writeAudit(tx, { tenantId, actorId, action: 'subscription.changed', entityType: 'tenant', entityId: tenantId, ip, metadata: { planCode, status } });
      return { tenantId, planCode, status };
    });
  }

  return { subscription, usage, invoices, listPlans, upsertPlan, setTenantPlan };
}

export type BillingService = ReturnType<typeof createBillingService>;
