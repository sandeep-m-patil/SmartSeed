export const ROLES = [
  'platform_admin',
  'company_admin',
  'manufacturer',
  'distributor',
  'wholesaler',
  'retailer',
  'auditor',
] as const;
export type Role = (typeof ROLES)[number];

/** Roles that must complete TOTP MFA before a token is issued. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['platform_admin', 'company_admin', 'auditor'];

export const ORG_TYPES = ['manufacturer', 'distributor', 'wholesaler', 'retailer'] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/**
 * Roles a company admin may assign to users inside their own tenant. Distributor /
 * wholesaler / retailer users belong to partner organizations and are created with
 * the organization (see organizations service), not as tenant users.
 */
export const TENANT_ASSIGNABLE_ROLES = ['company_admin', 'manufacturer'] as const;
export type TenantAssignableRole = (typeof TENANT_ASSIGNABLE_ROLES)[number];

export const PERMISSIONS = [
  'platform:tenant:read',
  'platform:tenant:write',
  'platform:audit:read',
  'platform:org:link',
  'platform:risk:read',
  'user:read',
  'user:write',
  'audit:read',
  'org:read',
  'org:write',
  'product:read',
  'product:write',
  'batch:read',
  'batch:create',
  'inventory:read',
  'transfer:read',
  'transfer:create',
  'transfer:receive',
  'sale:record',
  'qr:read',
  'qr:manage',
  'risk:read',
  'alert:read',
  'alert:manage',
  'investigation:read',
  'investigation:decide',
  'notification:read',
  'platform:billing:manage',
  'billing:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Single source of truth for authorization. The `permissions` /
 * `role_permissions` tables are seeded by migration and a test asserts they
 * match this matrix. Roles absent here have no permissions (deny by default).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  platform_admin: [
    'platform:tenant:read', 'platform:tenant:write', 'platform:audit:read', 'platform:org:link', 'platform:risk:read',
    'investigation:read', 'investigation:decide', 'alert:read', 'alert:manage', 'platform:billing:manage',
  ],
  company_admin: [
    'user:read', 'user:write', 'audit:read', 'org:read', 'org:write', 'product:read', 'product:write',
    'batch:read', 'transfer:read', 'inventory:read', 'qr:read', 'qr:manage', 'risk:read', 'alert:read',
    'alert:manage', 'investigation:read', 'investigation:decide', 'notification:read', 'billing:read',
  ],
  manufacturer: [
    'org:read', 'product:read', 'product:write', 'batch:read', 'batch:create', 'inventory:read',
    'transfer:read', 'transfer:create', 'qr:read', 'qr:manage', 'risk:read', 'alert:read', 'notification:read',
  ],
  distributor: [
    'org:read', 'product:read', 'batch:read', 'inventory:read', 'transfer:read', 'transfer:create',
    'transfer:receive', 'risk:read', 'notification:read',
  ],
  wholesaler: [
    'org:read', 'product:read', 'batch:read', 'inventory:read', 'transfer:read', 'transfer:create',
    'transfer:receive', 'risk:read', 'notification:read',
  ],
  retailer: [
    'org:read', 'product:read', 'batch:read', 'inventory:read', 'transfer:read', 'transfer:receive',
    'sale:record', 'risk:read', 'notification:read',
  ],
  auditor: [],
};

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

export function requiresMfa(roles: readonly Role[]): boolean {
  return roles.some((role) => MFA_REQUIRED_ROLES.includes(role));
}
