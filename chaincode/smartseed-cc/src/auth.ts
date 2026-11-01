import type { Context } from 'fabric-contract-api';
import { ATTR_ORG_ID, ATTR_ROLE, ATTR_TENANT_ID, ErrorCode, ORG_HASH_PREFIX, Role } from './constants';
import { sha256Hex } from './canonical';
import { ContractError } from './errors';
import type { Caller } from './types';

export const ROLES_OWNER: readonly Role[] = [Role.Manufacturer, Role.Distributor, Role.Retailer];
export const ROLES_PRIVILEGED: readonly Role[] = [Role.Authority, Role.Admin];

function readAttribute(ctx: Context, name: string): string {
  const value = ctx.clientIdentity.getAttributeValue(name);
  if (!value) throw new ContractError(ErrorCode.MissingAttribute, `certificate lacks attribute '${name}'`);
  return value;
}

/** Reads role / tenantId / orgId from the caller's X.509 certificate attributes. */
export function getCaller(ctx: Context): Caller {
  const rawRole = readAttribute(ctx, ATTR_ROLE);
  const role = Object.values(Role).find((r) => r === rawRole);
  if (!role) throw new ContractError(ErrorCode.UnauthorizedRole, `unknown role '${rawRole}'`);
  return { role, tenantId: readAttribute(ctx, ATTR_TENANT_ID), orgId: readAttribute(ctx, ATTR_ORG_ID) };
}

export function requireRole(caller: Caller, allowed: readonly Role[]): void {
  if (!allowed.includes(caller.role)) {
    throw new ContractError(ErrorCode.UnauthorizedRole, `role '${caller.role}' may not call this function`);
  }
}

export function assertTenant(caller: Caller, tenantId: string): void {
  if (caller.tenantId !== tenantId) {
    throw new ContractError(ErrorCode.WrongTenant, 'tenantId does not match caller identity');
  }
}

export function isPrivileged(caller: Caller): boolean {
  return ROLES_PRIVILEGED.includes(caller.role);
}

/** Stable pseudonym for a tenant: only this hash is written to events. */
export function orgHash(tenantId: string): string {
  return sha256Hex(`${ORG_HASH_PREFIX}${tenantId}`);
}
