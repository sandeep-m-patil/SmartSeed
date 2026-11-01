import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { hasPermission, requiresMfa, type Permission } from '@smartseed/shared';
import type { Db } from '../db/db';
import type { TokenService } from '../auth/tokens';
import { AppError, forbidden, unauthorized } from '../errors';
import { fail } from './envelope';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export const notFoundHandler: RequestHandler = (_req, res) => fail(res, 404, 'NOT_FOUND', 'Route not found');

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return fail(res, 400, 'VALIDATION_ERROR', 'Request validation failed', details);
    }
    if (err instanceof AppError) return fail(res, err.status, err.code, err.message, err.details);
    if (err instanceof SyntaxError && 'body' in err) return fail(res, 400, 'INVALID_JSON', 'Malformed JSON body');
    const clientStatus = (err as { status?: number }).status;
    if (typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
      const code = clientStatus === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      return fail(res, clientStatus, code, clientStatus === 413 ? 'Request body is too large' : 'Bad request');
    }
    logger.error({ err, requestId: req.requestId }, 'unhandled error');
    return fail(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  };
}

interface AuthDeps {
  tokens: TokenService;
  db: Db;
}

/** Verifies the bearer token, MFA claim for privileged roles, and that the tenant is still active. */
export function createAuthenticate({ tokens, db }: AuthDeps): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = await tokens.verifyAccess(header.slice('Bearer '.length)).catch(() => {
      throw unauthorized('INVALID_TOKEN', 'Invalid or expired token');
    });
    if (requiresMfa(claims.roles) && !claims.mfa) throw forbidden('MFA_REQUIRED', 'Multi-factor authentication required');
    if (claims.tid) {
      const status = await db.withSystem(async (tx) =>
        (await tx.query<{ status: string }>('SELECT status FROM tenants WHERE id = $1', [claims.tid])).rows[0]?.status);
      if (status !== 'active') throw forbidden('TENANT_NOT_ACTIVE', 'This organization is not active');
    }
    req.auth = { userId: claims.sub, tenantId: claims.tid, orgId: claims.oid, roles: claims.roles };
    next();
  };
}

/** Deny-by-default permission gate; must run after authenticate. */
export const requirePermission = (permission: Permission): RequestHandler => (req, _res, next) => {
  if (!req.auth || !hasPermission(req.auth.roles, permission)) throw forbidden();
  next();
};

/** Tenant-scoped routes must never run for a tenant-less (platform) identity. */
export function tenantOf(req: Request): string {
  if (!req.auth?.tenantId) throw forbidden('TENANT_REQUIRED', 'This action requires a tenant-scoped account');
  return req.auth.tenantId;
}
