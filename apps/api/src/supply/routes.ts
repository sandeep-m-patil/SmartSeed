import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  acceptTransferSchema, createBatchSchema, createOrganizationSchema, createProductSchema, createTransferSchema,
  dispatchTransferSchema, idempotencyKeySchema, pageQuerySchema, recordSaleSchema, rejectTransferSchema,
  updateProductSchema, ORG_TYPES,
} from '@smartseed/shared';
import { badRequest } from '../errors';
import { ok } from '../http/envelope';
import { requirePermission } from '../http/middleware';
import { clientIp } from '../audit/routes';
import { actorOf, orgActorOf, tenantActorOf } from './actor';
import type { BatchService } from './batches';
import type { OrgService } from './orgs';
import type { ProductService } from './products';
import type { SaleService } from './sales';
import type { TransferActions } from './transferActions';
import type { TransferService } from './transfers';
import { toTransferDto } from './transferTypes';

export interface SupplyDeps {
  authenticate: RequestHandler;
  orgs: OrgService;
  products: ProductService;
  batches: BatchService;
  transfers: TransferService;
  actions: TransferActions;
  sales: SaleService;
}

const idParam = z.string().uuid();
const transferListQuery = pageQuerySchema.extend({
  status: z.enum(['created', 'dispatched', 'in_transit', 'received', 'rejected', 'cancelled']).optional(),
  direction: z.enum(['incoming', 'outgoing']).optional(),
});

function idempotencyKey(req: Request): string {
  const parsed = idempotencyKeySchema.safeParse(req.header('Idempotency-Key'));
  if (!parsed.success) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header (8-100 chars) is required');
  return parsed.data;
}

export function supplyRoutes(d: SupplyDeps): Router {
  const r = Router();
  const auth = d.authenticate;
  const id = (req: Request) => idParam.parse(req.params.id);

  r.get('/organizations', auth, requirePermission('org:read'), async (req, res) => {
    const type = z.enum(ORG_TYPES).optional().parse(req.query.type);
    ok(res, await d.orgs.list(orgActorOf(req), type));
  });
  r.post('/organizations', auth, requirePermission('org:write'), async (req, res) => {
    ok(res, await d.orgs.create(tenantActorOf(req), createOrganizationSchema.parse(req.body)), {}, 201);
  });
  r.post('/platform/tenants/:id/organizations', auth, requirePermission('platform:org:link'), async (req, res) => {
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(req.body);
    ok(res, await d.orgs.link(id(req), orgId, req.auth!.userId, clientIp(req)));
  });

  r.post('/products', auth, requirePermission('product:write'), async (req, res) => {
    ok(res, await d.products.create(tenantActorOf(req), createProductSchema.parse(req.body)), {}, 201);
  });
  r.get('/products', auth, requirePermission('product:read'), async (req, res) => {
    const page = await d.products.list(actorOf(req), pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/products/:id', auth, requirePermission('product:read'), async (req, res) => {
    ok(res, await d.products.get(actorOf(req), id(req)));
  });
  r.patch('/products/:id', auth, requirePermission('product:write'), async (req, res) => {
    ok(res, await d.products.update(tenantActorOf(req), id(req), updateProductSchema.parse(req.body)));
  });

  r.post('/batches', auth, requirePermission('batch:create'), async (req, res) => {
    ok(res, await d.batches.create(tenantActorOf(req), createBatchSchema.parse(req.body)), {}, 201);
  });
  r.get('/batches', auth, requirePermission('batch:read'), async (req, res) => {
    const page = await d.batches.list(actorOf(req), pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/batches/:id', auth, requirePermission('batch:read'), async (req, res) => {
    ok(res, await d.batches.get(actorOf(req), id(req)));
  });
  r.get('/batches/:id/timeline', auth, requirePermission('batch:read'), async (req, res) => {
    ok(res, await d.batches.timeline(actorOf(req), id(req)));
  });

  r.get('/inventory', auth, requirePermission('inventory:read'), async (req, res) => {
    ok(res, await d.sales.inventory(orgActorOf(req)));
  });
  r.get('/inventory/:id/movements', auth, requirePermission('inventory:read'), async (req, res) => {
    ok(res, await d.sales.movements(orgActorOf(req), id(req)));
  });

  r.post('/transfers', auth, requirePermission('transfer:create'), async (req, res) => {
    const result = await d.transfers.create(orgActorOf(req), createTransferSchema.parse(req.body), idempotencyKey(req));
    ok(res, toTransferDto(result.transfer), { replayed: result.replayed }, result.replayed ? 200 : 201);
  });
  r.get('/transfers', auth, requirePermission('transfer:read'), async (req, res) => {
    const page = await d.transfers.list(orgActorOf(req), transferListQuery.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/transfers/:id', auth, requirePermission('transfer:read'), async (req, res) => {
    ok(res, await d.transfers.get(orgActorOf(req), id(req)));
  });
  r.post('/transfers/:id/dispatch', auth, requirePermission('transfer:create'), async (req, res) => {
    ok(res, await d.actions.dispatch(orgActorOf(req), id(req), dispatchTransferSchema.parse(req.body)));
  });
  r.post('/transfers/:id/transit', auth, requirePermission('transfer:create'), async (req, res) => {
    ok(res, await d.actions.markInTransit(orgActorOf(req), id(req)));
  });
  r.post('/transfers/:id/cancel', auth, requirePermission('transfer:create'), async (req, res) => {
    ok(res, await d.actions.cancel(orgActorOf(req), id(req)));
  });
  r.post('/transfers/:id/accept', auth, requirePermission('transfer:receive'), async (req, res) => {
    ok(res, await d.actions.accept(orgActorOf(req), id(req), acceptTransferSchema.parse(req.body ?? {})));
  });
  r.post('/transfers/:id/reject', auth, requirePermission('transfer:receive'), async (req, res) => {
    ok(res, await d.actions.reject(orgActorOf(req), id(req), rejectTransferSchema.parse(req.body).reason));
  });

  r.post('/sales', auth, requirePermission('sale:record'), async (req, res) => {
    const result = await d.sales.record(orgActorOf(req), recordSaleSchema.parse(req.body), idempotencyKey(req));
    ok(res, result, { replayed: result.replayed }, result.replayed ? 200 : 201);
  });

  return r;
}
