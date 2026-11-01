import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/db';
import { AppError } from '../errors';
import { writeAudit } from '../audit/audit';

const API_BASE = 'https://api.razorpay.com/v1';
const DEFAULT_TOTAL_COUNT = 120;
const REQUEST_TIMEOUT_MS = 15_000;

/** Constant-time check of the X-Razorpay-Signature header against the raw request body. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PaymentGateway {
  createSubscription(input: { gatewayPlanId: string; tenantId: string }): Promise<{ id: string; shortUrl: string | null }>;
}

/** Razorpay Subscriptions API. Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET; account and compliance setup are the operator's. */
export class RazorpayGateway implements PaymentGateway {
  constructor(private readonly keyId: string, private readonly keySecret: string, private readonly fetchImpl: typeof fetch = fetch) {}

  async createSubscription(input: { gatewayPlanId: string; tenantId: string }): Promise<{ id: string; shortUrl: string | null }> {
    const res = await this.fetchImpl(`${API_BASE}/subscriptions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ plan_id: input.gatewayPlanId, total_count: DEFAULT_TOTAL_COUNT, customer_notify: 1, notes: { tenantId: input.tenantId } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', `Payment gateway responded ${res.status}`);
    const json = (await res.json()) as { id: string; short_url?: string };
    return { id: json.id, shortUrl: json.short_url ?? null };
  }
}

interface RazorpayEvent {
  event: string;
  payload: {
    subscription?: { entity: { id: string; current_end?: number | null } };
    payment?: { entity: { id: string; amount: number; currency: string; subscription_id?: string; notes?: Record<string, string> } };
  };
}

const SUBSCRIPTION_STATUS: Record<string, string> = {
  'subscription.activated': 'active', 'subscription.charged': 'active', 'subscription.halted': 'past_due',
  'subscription.cancelled': 'cancelled', 'subscription.completed': 'cancelled', 'payment.failed': 'past_due',
};

/** Applies a verified webhook. Idempotent: invoices are keyed by the gateway payment id. */
export async function applyWebhook(db: Db, event: RazorpayEvent): Promise<{ handled: boolean }> {
  const status = SUBSCRIPTION_STATUS[event.event];
  if (!status) return { handled: false };
  const subId = event.payload.subscription?.entity.id ?? event.payload.payment?.entity.subscription_id;
  if (!subId) return { handled: false };
  return db.withSystem(async (tx) => {
    const sub = await tx.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM subscriptions WHERE gateway_ref = $1', [subId]);
    const row = sub.rows[0];
    if (!row) return { handled: false };
    const periodEnd = event.payload.subscription?.entity.current_end;
    await tx.query('UPDATE subscriptions SET status = $2, renews_at = COALESCE(to_timestamp($3::double precision), renews_at) WHERE id = $1', [row.id, status, periodEnd ?? null]);
    const pay = event.payload.payment?.entity;
    if (pay && (event.event === 'subscription.charged' || event.event === 'payment.failed')) {
      await tx.query(
        `INSERT INTO invoices (tenant_id, subscription_id, number, amount_minor, currency, status, gateway_ref, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8::boolean THEN now() END)
         ON CONFLICT (gateway_ref) WHERE gateway_ref IS NOT NULL DO UPDATE SET status = EXCLUDED.status, paid_at = COALESCE(invoices.paid_at, EXCLUDED.paid_at)`,
        [row.tenant_id, row.id, `INV-${pay.id}`, pay.amount, pay.currency, event.event === 'payment.failed' ? 'failed' : 'paid', pay.id, event.event !== 'payment.failed']);
    }
    await writeAudit(tx, { tenantId: row.tenant_id, actorId: null, action: `billing.${event.event}`, entityType: 'subscription', entityId: row.id });
    return { handled: true };
  });
}

/** Daily policy: expired trials become past_due; past_due beyond the grace period suspends the tenant. */
export async function subscriptionSweep(db: Db, graceDays: number): Promise<{ pastDue: number; suspended: number }> {
  return db.withSystem(async (tx) => {
    const pastDue = await tx.query(
      `UPDATE subscriptions SET status = 'past_due', renews_at = COALESCE(renews_at, trial_ends_at)
       WHERE status = 'trialing' AND trial_ends_at < now() RETURNING tenant_id`);
    const overdue = await tx.query<{ tenant_id: string }>(
      `UPDATE tenants SET status = 'suspended', updated_at = now() WHERE status = 'active' AND id IN (
         SELECT s.tenant_id FROM subscriptions s WHERE s.status IN ('past_due', 'cancelled')
           AND COALESCE(s.renews_at, s.trial_ends_at) < now() - make_interval(days => $1)) RETURNING id AS tenant_id`, [graceDays]);
    for (const t of overdue.rows) {
      await writeAudit(tx, { tenantId: t.tenant_id, actorId: null, action: 'tenant.suspended_for_billing', entityType: 'tenant', entityId: t.tenant_id });
    }
    return { pastDue: pastDue.rowCount ?? 0, suspended: overdue.rowCount ?? 0 };
  });
}
