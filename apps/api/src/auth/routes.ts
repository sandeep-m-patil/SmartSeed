import { Router, type RequestHandler } from 'express';
import { loginSchema, mfaTokenSchema, mfaVerifySchema, refreshSchema } from '@smartseed/shared';
import type { Db } from '../db/db';
import { ok } from '../http/envelope';
import { notFound } from '../errors';
import { clientIp } from '../audit/routes';
import type { AuthService } from './service';

interface Deps {
  auth: AuthService;
  db: Db;
  authenticate: RequestHandler;
  limiter: RequestHandler;
}

export function authRoutes({ auth, db, authenticate, limiter }: Deps): Router {
  const router = Router();

  router.post('/login', limiter, async (req, res) => {
    const result = await auth.login(loginSchema.parse(req.body), clientIp(req));
    if (result.kind === 'session') return ok(res, result.session);
    ok(res, { mfaRequired: true, mfaEnrollmentRequired: !result.enrolled, mfaToken: result.mfaToken });
  });

  router.post('/mfa/enroll', limiter, async (req, res) => {
    const { mfaToken } = mfaTokenSchema.parse(req.body);
    ok(res, await auth.enrollMfa(mfaToken));
  });

  router.post('/mfa/verify', limiter, async (req, res) => {
    const { mfaToken, code } = mfaVerifySchema.parse(req.body);
    ok(res, await auth.verifyMfa(mfaToken, code, clientIp(req)));
  });

  router.post('/refresh', limiter, async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    ok(res, await auth.refresh(refreshToken, clientIp(req)));
  });

  router.post('/logout', limiter, async (req, res) => {
    await auth.logout(refreshSchema.parse(req.body).refreshToken);
    ok(res, { loggedOut: true });
  });

  router.get('/me', authenticate, async (req, res) => {
    const row = await db.withSystem(async (tx) =>
      (await tx.query(
        `SELECT u.id, u.email, u.full_name, u.tenant_id, u.org_id, o.type AS org_type, o.legal_name AS org_name
         FROM users u LEFT JOIN organizations o ON o.id = u.org_id WHERE u.id = $1`, [req.auth?.userId])).rows[0]);
    if (!row) throw notFound();
    ok(res, { id: row.id, email: row.email, fullName: row.full_name, tenantId: row.tenant_id, orgId: row.org_id, orgType: row.org_type, orgName: row.org_name, roles: req.auth?.roles });
  });

  return router;
}
