import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { pageQuerySchema } from '@smartseed/shared';
import { ok } from '../http/envelope';
import { requirePermission } from '../http/middleware';
import { actorOf, tenantActorOf } from '../supply/actor';
import type { PassportService } from '../passport/full';
import type { Verifier } from '../passport/verify';
import type { PublicService } from '../public/service';
import type { QrService } from './service';

const idParam = z.string().uuid();
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const packagesSchema = z.object({ count: z.number().int().min(1).max(5_000) });
const formatSchema = z.enum(['png', 'svg', 'label']).default('png');
const tokenParam = z.string().min(1).max(128);
const scanQuery = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lon: z.coerce.number().min(-180).max(180).optional() });
const deviceHeader = z.string().uuid().optional();

export interface QrDeps {
  authenticate: RequestHandler;
  publicLimiter: RequestHandler;
  qr: QrService;
  passport: PassportService;
  verifier: Verifier;
  publicService: PublicService;
}

export function qrRoutes(d: QrDeps): Router {
  const r = Router();
  const auth = d.authenticate;
  const id = (req: { params: Record<string, string | string[] | undefined> }) => idParam.parse(req.params.id);

  r.post('/batches/:id/qr', auth, requirePermission('qr:manage'), async (req, res) => {
    ok(res, await d.qr.createBatchQr(tenantActorOf(req), id(req)), {}, 201);
  });
  r.post('/batches/:id/packages', auth, requirePermission('qr:manage'), async (req, res) => {
    ok(res, await d.qr.createPackageQrs(tenantActorOf(req), id(req), packagesSchema.parse(req.body).count), {}, 201);
  });
  r.get('/batches/:id/qr', auth, requirePermission('qr:read'), async (req, res) => {
    const page = await d.qr.list(actorOf(req), id(req), pageQuerySchema.parse(req.query));
    ok(res, page.items, { nextCursor: page.nextCursor });
  });
  r.get('/batches/:id/passport', auth, requirePermission('batch:read'), async (req, res) => {
    ok(res, await d.passport.full(actorOf(req), id(req)));
  });
  r.get('/qr/:id/download', auth, requirePermission('qr:read'), async (req, res) => {
    const file = await d.qr.download(actorOf(req), id(req), formatSchema.parse(req.query.format));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  });
  r.post('/qr/:id/revoke', auth, requirePermission('qr:manage'), async (req, res) => {
    ok(res, await d.qr.revoke(tenantActorOf(req), id(req), reasonSchema.parse(req.body).reason));
  });
  r.post('/qr/:id/regenerate', auth, requirePermission('qr:manage'), async (req, res) => {
    ok(res, await d.qr.regenerate(tenantActorOf(req), id(req), reasonSchema.parse(req.body).reason), {}, 201);
  });
  r.get('/qr/:id/scans', auth, requirePermission('qr:read'), async (req, res) => {
    ok(res, await d.qr.scans(actorOf(req), id(req), pageQuerySchema.parse(req.query)));
  });

  // ----- public (no account) -----
  r.get('/public/verify/:token', d.publicLimiter, async (req, res) => {
    const { lat, lon } = scanQuery.parse(req.query);
    const deviceId = deviceHeader.parse(req.header('X-Device-Id'));
    res.setHeader('Cache-Control', 'no-store');
    ok(res, await d.verifier.verify(tokenParam.parse(req.params.token), { ip: req.ip ?? 'unknown', deviceId, lat, lon }));
  });
  r.post('/public/devices', d.publicLimiter, async (req, res) => {
    const body = z.object({
      deviceId: z.string().uuid(), pushToken: z.string().max(300).optional(),
      language: z.enum(['en', 'te', 'hi']).default('en'), region: z.string().max(60).optional(),
    }).parse(req.body);
    ok(res, await d.publicService.registerDevice(body), {}, 201);
  });
  r.post('/public/reports', d.publicLimiter, async (req, res) => {
    const body = z.object({
      token: tokenParam, description: z.string().trim().max(1000).optional(), region: z.string().max(60).optional(),
    }).parse(req.body);
    ok(res, await d.publicService.report({ ...body, deviceId: deviceHeader.parse(req.header('X-Device-Id')) }), {}, 201);
  });
  r.get('/public/notifications', d.publicLimiter, async (req, res) => {
    ok(res, await d.publicService.notifications(z.string().uuid().parse(req.query.deviceId)));
  });

  return r;
}
