import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { hasPermission, pageQuerySchema } from '@smartseed/shared';
import type { Config } from '../config';
import type { Db } from '../db/db';
import { AppError, forbidden } from '../errors';
import { ok } from '../http/envelope';
import { requirePermission, tenantOf } from '../http/middleware';
import { clientIp } from '../audit/routes';
import { streamEvents } from '../events/sse';
import { INVESTIGATION_ACTIONS, OUTCOMES, type InvestigationService } from '../investigations/service';
import { CHANNELS, type NotificationService } from '../notifications/service';
import type { BillingService } from '../billing/service';
import { applyWebhook, verifyWebhookSignature, type PaymentGateway } from '../billing/razorpay';
import type { AlertService } from './alertService';
import type { DashboardService } from './dashboard';

export interface RiskRoutesDeps {
  db: Db;
  config: Config;
  authenticate: RequestHandler;
  alerts: AlertService;
  dashboard: DashboardService;
  investigations: InvestigationService;
  notifications: NotificationService;
  billing: BillingService;
  gateway?: PaymentGateway | undefined;
}

const idParam = z.string().uuid();
const optionalDate = z.string().datetime().optional();
const alertQuery = pageQuerySchema.extend({
  level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  status: z.enum(['open', 'investigating', 'resolved', 'dismissed']).optional(),
  from: optionalDate, to: optionalDate, productId: z.string().uuid().optional(), batchId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  investigationStatus: z.enum(['open', 'under_investigation', 'verification_requested', 'confirmed_suspicious', 'false_positive', 'escalated_manufacturer', 'escalated_authority', 'resolved']).optional(),
});
const actionSchema = z.object({
  action: z.enum(INVESTIGATION_ACTIONS), note: z.string().trim().max(1000).optional(), outcome: z.enum(OUTCOMES).optional(),
});
const prefsSchema = z.array(z.object({ type: z.string().max(60), channel: z.enum(CHANNELS), enabled: z.boolean() })).max(100);
const planSchema = z.object({
  code: z.string().regex(/^[a-z0-9_-]{2,40}$/), name: z.string().min(2).max(80),
  limits: z.object({ batches: z.number().int().min(0).optional(), users: z.number().int().min(0).optional(), scans: z.number().int().min(0).optional(), investigations: z.number().int().min(0).optional() }),
  priceMinor: z.number().int().min(0), currency: z.string().length(3), billingInterval: z.string().max(20).optional(), gatewayPlanId: z.string().max(100).optional(),
});

/** Platform administrators see every tenant; everyone else is pinned to their own tenant. */
function scopeOf(req: Request) {
  const platform = hasPermission(req.auth!.roles, 'platform:risk:read');
  return { tenantId: platform ? null : tenantOf(req), userId: req.auth!.userId, ip: clientIp(req) };
}

export function riskRoutes(d: RiskRoutesDeps): Router {
  const r = Router();
  const auth = d.authenticate;
  const id = (req: Request) => idParam.parse(req.params.id);

  r.get('/risk/overview', auth, requirePermission('risk:read'), async (req, res) => ok(res, await d.dashboard.overview(scopeOf(req).tenantId)));
  r.get('/risk/analytics', auth, requirePermission('risk:read'), async (req, res) => ok(res, await d.dashboard.analytics(scopeOf(req).tenantId)));

  r.get('/alerts', auth, requirePermission('alert:read'), async (req, res) => {
    const page = await d.alerts.list(scopeOf(req), alertQuery.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/alerts/:id', auth, requirePermission('alert:read'), async (req, res) => ok(res, await d.alerts.get(scopeOf(req), id(req))));
  r.patch('/alerts/:id', auth, requirePermission('alert:manage'), async (req, res) => {
    const { assigneeId } = z.object({ assigneeId: z.string().uuid() }).parse(req.body);
    ok(res, await d.alerts.assign(scopeOf(req), id(req), assigneeId));
  });

  r.get('/investigations', auth, requirePermission('investigation:read'), async (req, res) => {
    const q = pageQuerySchema.extend({ status: z.string().max(40).optional() }).parse(req.query);
    const page = await d.investigations.list(scopeOf(req), q);
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/investigations/:id', auth, requirePermission('investigation:read'), async (req, res) => ok(res, await d.investigations.get(scopeOf(req), id(req))));
  r.post('/investigations/:id/actions', auth, requirePermission('investigation:decide'), async (req, res) => {
    ok(res, await d.investigations.act(scopeOf(req), id(req), actionSchema.parse(req.body)), {}, 201);
  });

  r.get('/notifications', auth, requirePermission('notification:read'), async (req, res) => {
    const page = await d.notifications.list(req.auth!.userId, req.auth!.tenantId, pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.post('/notifications/:id/read', auth, requirePermission('notification:read'), async (req, res) => ok(res, await d.notifications.markRead(req.auth!.userId, id(req))));
  r.get('/notification-preferences', auth, requirePermission('notification:read'), async (req, res) => ok(res, await d.notifications.preferences(req.auth!.userId)));
  r.put('/notification-preferences', auth, requirePermission('notification:read'), async (req, res) => ok(res, await d.notifications.setPreferences(req.auth!.userId, prefsSchema.parse(req.body))));

  r.get('/subscription', auth, requirePermission('billing:read'), async (req, res) => ok(res, await d.billing.subscription(tenantOf(req))));
  r.get('/usage', auth, requirePermission('billing:read'), async (req, res) => ok(res, await d.billing.usage(tenantOf(req))));
  r.get('/invoices', auth, requirePermission('billing:read'), async (req, res) => ok(res, await d.billing.invoices(tenantOf(req))));

  r.get('/platform/plans', auth, requirePermission('platform:billing:manage'), async (_req, res) => ok(res, await d.billing.listPlans()));
  r.post('/platform/plans', auth, requirePermission('platform:billing:manage'), async (req, res) => {
    ok(res, await d.billing.upsertPlan(planSchema.parse(req.body), req.auth!.userId, clientIp(req)), {}, 201);
  });
  r.put('/platform/tenants/:id/subscription', auth, requirePermission('platform:billing:manage'), async (req, res) => {
    const body = z.object({ planCode: z.string().max(40), status: z.enum(['trialing', 'active', 'past_due', 'cancelled']).default('active') }).parse(req.body);
    ok(res, await d.billing.setTenantPlan(id(req), body.planCode, body.status, req.auth!.userId, clientIp(req)));
  });
  r.post('/platform/tenants/:id/billing/checkout', auth, requirePermission('platform:billing:manage'), async (req, res) => {
    if (!d.gateway) throw new AppError(501, 'BILLING_NOT_CONFIGURED', 'No payment gateway is configured');
    const { planCode } = z.object({ planCode: z.string().max(40) }).parse(req.body);
    const tenantId = id(req);
    const plan = await d.db.withSystem(async (tx) => (await tx.query<{ gateway_plan_id: string | null }>('SELECT gateway_plan_id FROM plans WHERE code = $1', [planCode])).rows[0]);
    if (!plan?.gateway_plan_id) throw new AppError(400, 'PLAN_NOT_BILLABLE', 'This plan has no gateway plan id');
    const created = await d.gateway.createSubscription({ gatewayPlanId: plan.gateway_plan_id, tenantId });
    await d.db.withSystem((tx) => tx.query(
      'UPDATE subscriptions SET gateway_ref = $2 WHERE id = (SELECT id FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1)', [tenantId, created.id]));
    ok(res, { subscriptionId: created.id, checkoutUrl: created.shortUrl });
  });

  // Gateway webhook: authenticated by signature, not by bearer token.
  r.post('/billing/webhook', async (req, res) => {
    const secret = d.config.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw forbidden('WEBHOOK_DISABLED', 'Webhook is not configured');
    if (!req.rawBody || !verifyWebhookSignature(req.rawBody, req.header('X-Razorpay-Signature'), secret)) throw forbidden('BAD_SIGNATURE', 'Invalid webhook signature');
    ok(res, await applyWebhook(d.db, req.body));
  });

  r.get('/events', auth, (req, res) => {
    const s = scopeOf(req);
    streamEvents(req, res, d.db, { tenantId: s.tenantId, userId: s.userId }, d.config.SSE_INTERVAL_MS);
  });

  return r;
}
