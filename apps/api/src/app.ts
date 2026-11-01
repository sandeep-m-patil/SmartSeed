import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import {
  createUserSchema, pageQuerySchema, registerTenantSchema, updateTenantStatusSchema, TENANT_STATUSES,
} from '@smartseed/shared';
import type { Config } from './config';
import type { Db } from './db/db';
import { createAuthService } from './auth/service';
import type { TokenService } from './auth/tokens';
import { authRoutes } from './auth/routes';
import { createTenantService } from './tenants/service';
import { createUserService } from './users/service';
import { listAudit, clientIp } from './audit/routes';
import {
  createAuthenticate, createErrorHandler, notFoundHandler, requestId, requirePermission, tenantOf,
} from './http/middleware';
import { ok } from './http/envelope';
import { createLimiters } from './http/rateLimit';
import { createMetrics } from './http/metrics';
import { createOrgService } from './supply/orgs';
import { createProductService } from './supply/products';
import { createBatchService } from './supply/batches';
import { createTransferService } from './supply/transfers';
import { createTransferActions } from './supply/transferActions';
import { createSaleService } from './supply/sales';
import { supplyRoutes } from './supply/routes';
import { createQrService } from './qr/service';
import { qrRoutes } from './qr/routes';
import { createPassportService } from './passport/full';
import { createVerifier } from './passport/verify';
import { createPublicService } from './public/service';
import { riskRoutes } from './risk/routes';
import { createAlertService } from './risk/alertService';
import { createDashboardService } from './risk/dashboard';
import { createInvestigationService } from './investigations/service';
import { createNotificationService } from './notifications/service';
import { createBillingService } from './billing/service';
import type { PaymentGateway } from './billing/razorpay';

export interface AppDeps {
  config: Config;
  db: Db;
  tokens: TokenService;
  logger: Logger;
  redis?: Redis;
  paymentGateway?: PaymentGateway;
}

const BODY_LIMIT = '100kb';
const tenantListQuery = pageQuerySchema.extend({ status: z.enum(TENANT_STATUSES).optional() });

/** The API process only reads notifications; delivery happens in the worker, so senders here must never be used. */
const workerOnly = { send: async () => { throw new Error('delivery runs in the worker process'); } };

export function createApp({ config, db, tokens, logger, redis, paymentGateway }: AppDeps): Express {
  const app = express();
  const limiters = createLimiters(config, redis);
  const authenticate = createAuthenticate({ tokens, db });
  const authService = createAuthService({ db, tokens, config });
  const tenants = createTenantService(db);
  const users = createUserService(db);
  const supply = {
    authenticate,
    orgs: createOrgService(db),
    products: createProductService(db),
    batches: createBatchService(db),
    transfers: createTransferService(db),
    actions: createTransferActions(db),
    sales: createSaleService(db),
  };

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as { requestId?: string }).requestId as string,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: false }));
  app.use(express.json({ limit: BODY_LIMIT, verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
  const metrics = createMetrics(db);
  app.use(metrics.middleware);
  app.use(limiters.global);
  if (config.METRICS_TOKEN) app.get('/metrics', metrics.handler(config.METRICS_TOKEN));

  app.get('/healthz', (_req, res) => void res.json({ status: 'ok' }));
  app.get('/readyz', async (_req, res) => {
    await db.withNoContext((tx) => tx.query('SELECT 1'));
    res.json({ status: 'ready' });
  });

  const v1 = express.Router();
  v1.use('/auth', authRoutes({ auth: authService, db, authenticate, limiter: limiters.auth }));

  v1.post('/tenants/register', limiters.register, async (req, res) => {
    ok(res, await tenants.register(registerTenantSchema.parse(req.body), clientIp(req)), {}, 201);
  });

  v1.get('/users', authenticate, requirePermission('user:read'), async (req, res) => {
    const page = await users.list(tenantOf(req), pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  v1.post('/users', authenticate, requirePermission('user:write'), async (req, res) => {
    const actor = { userId: req.auth!.userId, tenantId: tenantOf(req), ip: clientIp(req) };
    ok(res, await users.create(actor, createUserSchema.parse(req.body)), {}, 201);
  });
  v1.get('/audit-logs', authenticate, requirePermission('audit:read'), async (req, res) => {
    const page = await listAudit(db, tenantOf(req), pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });

  v1.get('/platform/tenants', authenticate, requirePermission('platform:tenant:read'), async (req, res) => {
    const page = await tenants.list(tenantListQuery.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  v1.patch('/platform/tenants/:id', authenticate, requirePermission('platform:tenant:write'), async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const { status } = updateTenantStatusSchema.parse(req.body);
    ok(res, await tenants.setStatus(id, status, req.auth!.userId, clientIp(req)));
  });
  v1.get('/platform/audit-logs', authenticate, requirePermission('platform:audit:read'), async (req, res) => {
    const page = await listAudit(db, null, pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });

  v1.use(supplyRoutes(supply));
  v1.use(
    riskRoutes({
      db, config, authenticate, gateway: paymentGateway,
      alerts: createAlertService(db),
      dashboard: createDashboardService(db),
      investigations: createInvestigationService({ db, logger }),
      notifications: createNotificationService({ db, email: workerOnly, push: workerOnly, logger, encryptionKey: config.FIELD_ENCRYPTION_KEY }),
      billing: createBillingService(db),
    }),
  );
  v1.use(
    qrRoutes({
      authenticate,
      publicLimiter: limiters.publicApi,
      qr: createQrService(db, config),
      passport: createPassportService(db),
      verifier: createVerifier(db, config),
      publicService: createPublicService(db, config),
    }),
  );

  app.use('/v1', v1);
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}
