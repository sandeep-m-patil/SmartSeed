import type { Request } from 'express';
import { forbidden } from '../errors';
import { clientIp } from '../audit/routes';

export interface Actor {
  userId: string;
  tenantId: string | null;
  orgId: string | null;
  ip: string;
}

export interface OrgActor extends Actor {
  orgId: string;
}

export interface TenantActor extends OrgActor {
  tenantId: string;
}

export function actorOf(req: Request): Actor {
  return { userId: req.auth!.userId, tenantId: req.auth!.tenantId, orgId: req.auth!.orgId, ip: clientIp(req) };
}

/** Supply-chain operations need an organization identity. */
export function orgActorOf(req: Request): OrgActor {
  const actor = actorOf(req);
  if (!actor.orgId) throw forbidden('ORG_REQUIRED', 'This action requires an organization-scoped account');
  return actor as OrgActor;
}

/** Catalogue writes are limited to manufacturer tenants. */
export function tenantActorOf(req: Request): TenantActor {
  const actor = orgActorOf(req);
  if (!actor.tenantId) throw forbidden('TENANT_REQUIRED', 'This action requires a tenant-scoped account');
  return actor as TenantActor;
}
